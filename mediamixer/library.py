"""Filesystem discovery and reward-weighted picking of folders/videos."""
from __future__ import annotations

import json
import math
import os
import random
import threading
import time
from typing import Iterable, List, Optional, Tuple, Union

from . import sources
from .bandit import decayed_value, exploration_score, softmax_pick
from .config import Config
from .db import Database

# Videos sitting directly in a source folder (not sorted into a category folder) are
# grouped under this implicit folder, so the per-category rotation/weighting
# system still works without forcing the user to pre-sort their library.
GENERAL_FOLDER = "General"

# Self-Building Favorites: a pseudo-folder, not a real filesystem directory -
# its contents are every video with at least one heart, across every real
# folder, so "sorting into a favorites folder" happens automatically just by
# hearting a clip rather than requiring any manual cataloging. Only ever
# reachable by explicit selection (pick_folder's automatic weighted rotation
# never picks it, since it has no row in folder_weights) and only listed at
# all once at least one video qualifies.
FAVORITES_FOLDER = "❤Favorites"


_SCAN_TTL_S = 5.0
_scan_cache: dict = {}
_sync_lock = threading.Lock()


def scan_videos(config: Config, max_age_s: float = _SCAN_TTL_S) -> List[Tuple[str, str, str]]:
    """(root id, absolute path, category) for every clip under every Tile
    Source folder, recursively. Cached briefly - the folder list is read on
    every page load and a big library is a real walk."""
    key = os.path.abspath(config.db_path)
    now = time.monotonic()
    hit = _scan_cache.get(key)
    if hit and max_age_s > 0 and now - hit[0] < max_age_s:
        return hit[1]
    src = sources.get(config)
    items = [
        (root.id, path, src.category(root, path, GENERAL_FOLDER))
        for root, path in src.iter_files("tiles", config.video_exts)
    ]
    _scan_cache[key] = (now, items)
    return items


def sync_library(db: Database, config: Config) -> List[str]:
    """Scan the Tile Source folders and bring the DB in line: new clips are
    registered, clips that are gone (or whose folder was removed) sit out."""
    src = sources.get(config)
    src.ensure_default_dirs()
    with _sync_lock:
        items = scan_videos(config, max_age_s=0)
        # Fresh Drop is for clips that turn up later in a folder already in
        # the library - not for the library itself on its first scan, and
        # not for a whole folder that's just been added as a source.
        scanned = set(json.loads(db.get_setting("scanned_roots") or "[]"))
        library_existed = db.video_count() > 0
        fresh = {path for rid, path, _cat in items if library_existed and rid in scanned}
        folders = sorted({cat for _rid, _path, cat in items})
        for folder in folders:
            db.ensure_folder(folder)
        db.sync_videos([(path, cat) for _rid, path, cat in items], fresh)
        db.release_fresh_beyond(config.fresh_hold_max)
        now_scanned = scanned | {r.id for r in src.roots("tiles") if os.path.isdir(r.path)}
        if now_scanned != scanned:
            db.set_setting("scanned_roots", json.dumps(sorted(now_scanned)))
    return _ordered(folders)


def _ordered(cats) -> List[str]:
    cats = set(cats)
    return ([GENERAL_FOLDER] if GENERAL_FOLDER in cats else []) + sorted(cats - {GENERAL_FOLDER})


def list_folders(config: Config) -> List[str]:
    return _ordered(cat for _rid, _path, cat in scan_videos(config))


def list_folders_with_favorites(db: Database, config: Config) -> List[str]:
    """list_folders(), plus the Favorites pseudo-folder appended once at
    least one video has been hearted. Kept separate from list_folders()
    itself so every other caller (sync, filesystem scans) stays untouched
    by a concept that only exists in the DB, not on disk."""
    folders = list_folders(config)
    if db.has_favorites():
        folders.append(FAVORITES_FOLDER)
    return folders


def list_all_videos(config: Config) -> List[str]:
    """Flat list of every clip in the library, in the "<root id>/<path>"
    form the browser uses. Used by features that just want "something from
    the library" - e.g. the floating overlay FX - without the
    reward-weighted selection machinery."""
    return [rid + "/" + os.path.relpath(path, root_path).replace("\\", "/")
            for rid, path, root_path in _with_root_paths(config)]


def _with_root_paths(config: Config):
    by_id = {r.id: r.path for r in sources.get(config).roots("tiles")}
    for rid, path, _cat in scan_videos(config):
        yield rid, path, by_id[rid]


def pick_folder(db: Database, config: Config, exclude: Optional[str] = None) -> Optional[str]:
    now = time.time()
    rows = db.folder_rewards()
    candidates = [r for r in rows if r["folder_name"] != exclude] or rows
    if not candidates:
        return None
    items = [r["folder_name"] for r in candidates]
    scores = [decayed_value(r["ema_reward"], r["updated_at"], now, config.decay_halflife_s) for r in candidates]
    return softmax_pick(items, scores, config.softmax_temp)


def pick_video(
    db: Database,
    config: Config,
    folder: str,
    exclude: Union[str, Iterable[str], None] = None,
    exploration_bonus: Optional[float] = None,
    energy: float = 1.0,
    taste_strength: float = 0.0,
    match: Optional[dict] = None,
) -> Optional[str]:
    """Pick a video from `folder`, avoiding `exclude` (one path, or any collection of
    paths - e.g. every video currently showing on another screen, so the same clip
    doesn't end up playing simultaneously in two tiles).

    `exploration_bonus` overrides config.exploration_bonus_c when given - e.g. an
    auto-pilot mode can turn this up during a climax to favor fresher/rarely-played
    clips specifically when attention is already heightened.
    """
    now = time.time()
    bonus = config.exploration_bonus_c if exploration_bonus is None else exploration_bonus
    rows = db.favorite_video_rewards() if folder == FAVORITES_FOLDER else db.video_rewards(folder)
    if not rows and folder != FAVORITES_FOLDER:
        rows = db.video_rewards(folder, include_fresh=True)  # a folder holding nothing but fresh clips still has to play something
    if not rows:
        return None
    if exclude:
        exclude_paths = {exclude} if isinstance(exclude, str) else set(exclude)
        excluded_norm = {os.path.normpath(p).lower() for p in exclude_paths if p}
        rows = [r for r in rows if os.path.normpath(r["video_path"]).lower() not in excluded_norm] or rows
    items = [r["video_path"] for r in rows]
    scores = [
        exploration_score(
            decayed_value(r["ema_reward"], r["updated_at"], now, config.decay_halflife_s),
            r["play_count"],
            bonus,
        )
        for r in rows
    ]
    _apply_motion_lean(scores, rows, energy, config.dna_motion_bias)
    if match:
        _apply_match(scores, rows, match, config.match_cut_strength)
    if taste_strength > 0:
        taste = dna_taste(db)
        if taste:
            for i, r in enumerate(rows):
                scores[i] += dna_taste_bonus(taste, r, taste_strength)
    return softmax_pick(items, scores, config.softmax_temp)


def _apply_motion_lean(scores: list, rows, energy: float, bias: float):
    """Clip DNA: nudge scores toward high-motion clips when the session's
    energy is up and calmer ones when it's settled. A clip `z` standard
    deviations from the folder's average motion moves by bias * lean * z *
    0.25 (lean = energy away from neutral, capped at +-1) - at full lean a
    clip 2 sd livelier is ~1.65x as likely at the default bias, never a
    filter. Unanalysed clips stay neutral."""
    lean = max(-1.0, min(1.0, (energy - 1.0) / 0.25))
    if not bias or abs(lean) < 0.04:
        return
    motions = [r["motion"] for r in rows if "motion" in r.keys() and r["motion"] is not None]
    if len(motions) < 5:
        return
    mean = sum(motions) / len(motions)
    sd = (sum((m - mean) ** 2 for m in motions) / len(motions)) ** 0.5 or 1.0
    for i, r in enumerate(rows):
        m = r["motion"] if "motion" in r.keys() else None
        if m is not None:
            scores[i] += bias * lean * max(-2.5, min(2.5, (m - mean) / sd)) * 0.25


# ---- Match cuts ----
MATCH_TRAIT_WEIGHTS = {"motion": 1.0, "brightness": 0.6, "warmth": 0.3}
MATCH_HEADING_FULL = 0.12  # an energy change this size over ~20s = full lean


def match_target(db: Database, outgoing: Optional[str], heading: float) -> Optional[dict]:
    """What the next clip should look like to continue `outgoing`: the same
    look, with movement nudged the way the energy is heading."""
    row = db.dna_for(outgoing) if outgoing else None
    if row is None or row["motion"] is None:
        return None
    lean = max(-1.0, min(1.0, heading / MATCH_HEADING_FULL))
    return {"motion": row["motion"], "brightness": row["brightness"], "warmth": row["warmth"], "motion_shift_sd": 0.8 * lean}


def _apply_match(scores: list, rows, match: dict, strength: float):
    """Penalise distance from the match target, per trait in folder standard
    deviations (squared, capped at 2.5 sd): a clip 2 sd off in movement is
    ~0.37x as likely at strength 1. Unanalysed clips stay neutral."""
    if not strength:
        return
    keys = rows[0].keys() if rows else []
    for trait, weight in MATCH_TRAIT_WEIGHTS.items():
        if trait not in keys or match.get(trait) is None:
            continue
        vals = [r[trait] for r in rows if r[trait] is not None]
        if len(vals) < 5:
            continue
        mean = sum(vals) / len(vals)
        sd = (sum((v - mean) ** 2 for v in vals) / len(vals)) ** 0.5 or 1.0
        target = (match[trait] - mean) / sd + (match.get("motion_shift_sd", 0.0) if trait == "motion" else 0.0)
        for i, r in enumerate(rows):
            if r[trait] is None:
                continue
            d = min(2.5, abs((r[trait] - mean) / sd - target))
            scores[i] -= strength * weight * 0.15 * d * d


# ---- Clip DNA taste ----
# From all-time hearts per play: for each trait (brightness, warmth,
# saturation, motion), how much more (or less) you heart clips in its low /
# middle / high third than clips overall. Plays are the exposure, so a trait
# that's simply shown a lot doesn't look loved just for being around.
DNA_TASTE_TRAITS = {
    "brightness": ("dark", "bright"),
    "warmth": ("cool", "warm"),
    "saturation": ("muted", "vivid"),
    "motion": ("calm", "lively"),
}
DNA_TASTE_PRIOR_PLAYS = 40  # pseudo-plays pulling every lift toward 1 until there's real evidence
DNA_TASTE_RANGE = (0.5, 2.0)
_dna_taste_cache = {"at": 0.0, "value": None}


def dna_taste(db: Database, max_age_s: float = 600) -> Optional[dict]:
    """{trait: {"cuts": (low, high), "lifts": [low, mid, high]}} or None."""
    now = time.time()
    if _dna_taste_cache["value"] is not None and now - _dna_taste_cache["at"] < max_age_s:
        return _dna_taste_cache["value"]
    rows = db.dna_heart_rows()
    total_h = sum(r["heart_count"] for r in rows)
    total_p = sum(r["play_count"] for r in rows)
    if len(rows) < 30 or total_h < 20 or total_p <= 0:
        return None
    rate = total_h / total_p
    taste = {}
    for trait in DNA_TASTE_TRAITS:
        vals = sorted(r[trait] for r in rows if r[trait] is not None)
        cuts = (vals[len(vals) // 3], vals[2 * len(vals) // 3])
        h, p = [0, 0, 0], [0, 0, 0]
        for r in rows:
            if r[trait] is None:
                continue
            t = 0 if r[trait] < cuts[0] else 2 if r[trait] > cuts[1] else 1
            h[t] += r["heart_count"]
            p[t] += r["play_count"]
        lifts = [
            max(DNA_TASTE_RANGE[0], min(DNA_TASTE_RANGE[1], (h[t] + DNA_TASTE_PRIOR_PLAYS * rate) / (p[t] * rate + DNA_TASTE_PRIOR_PLAYS * rate)))
            for t in range(3)
        ]
        taste[trait] = {"cuts": cuts, "lifts": [round(x, 3) for x in lifts]}
    _dna_taste_cache.update(at=now, value=taste)
    return taste


def dna_taste_bonus(taste: Optional[dict], row, strength: float) -> float:
    """Score bonus for one clip: strength x the sum of log-lifts of its traits."""
    if not taste or strength <= 0:
        return 0.0
    keys = row.keys()
    bonus = 0.0
    for trait, info in taste.items():
        v = row[trait] if trait in keys else None
        if v is None:
            continue
        t = 0 if v < info["cuts"][0] else 2 if v > info["cuts"][1] else 1
        bonus += math.log(info["lifts"][t])
    return strength * bonus


def gradient_picks(db: Database, folder: str, metric: str, count: int, exclude: Iterable[str] = ()) -> list:
    """`count` clips spread evenly along `metric` (brightness/warmth/motion),
    lowest first - the Gradient moment's grid."""
    excluded = {os.path.normpath(p).lower() for p in exclude if p}
    rows = [r for r in db.dna_rows(folder) if r[metric] is not None and os.path.normpath(r["video_path"]).lower() not in excluded]
    if len(rows) < count:
        return []
    rows.sort(key=lambda r: r[metric])
    # Evenly spaced positions along the sorted list, with a little jitter so
    # the same gradient doesn't repeat exactly.
    step = (len(rows) - 1) / max(1, count - 1)
    picks, used = [], set()
    for k in range(count):
        target = k * step + random.uniform(-0.35, 0.35) * step
        idx = max(0, min(len(rows) - 1, int(round(target))))
        while idx in used and idx + 1 < len(rows):
            idx += 1
        used.add(idx)
        picks.append(rows[idx]["video_path"])
    return picks


def similar_clips(db: Database, path: str, limit: int = 12, exclude: Iterable[str] = ()) -> list:
    """Clips that look like `path`: close in warmth and brightness, and in
    accent colour when both have one - for colour-matched double exposure."""
    ref = db.dna_for(path)
    if ref is None:
        return []
    excluded = {os.path.normpath(p).lower() for p in exclude if p} | {os.path.normpath(path).lower()}

    def distance(r) -> float:
        d = abs((r["warmth"] or 0) - (ref["warmth"] or 0)) / 0.1 + abs((r["brightness"] or 0) - (ref["brightness"] or 0)) / 0.1
        if r["accent_hue"] is not None and ref["accent_hue"] is not None:
            gap = abs(r["accent_hue"] - ref["accent_hue"]) % 360
            d += min(gap, 360 - gap) / 30
        elif (r["accent_hue"] is None) != (ref["accent_hue"] is None):
            d += 1.5
        return d

    rows = [r for r in db.dna_rows() if os.path.normpath(r["video_path"]).lower() not in excluded]
    rows.sort(key=distance)
    return [r["video_path"] for r in rows[:limit]]


def pick_video_jackpot(
    db: Database, folder: str, offset: int = 0, exclude: Union[str, Iterable[str], None] = None
) -> Optional[str]:
    """Jackpot pick: a draw from the hearted clips in `folder`, weighted by
    the square root of heart count (linear weighting snowballed: the most
    picked clips got hearted most, 42 -> 98 hearts in a week), skipping anything in `exclude` (so two screens can't land on
    the same clip in one jackpot batch). More hearts = more likely, but no
    fixed top-N wins every time. Falls back to rank order (`offset`-th best)
    only when nothing usable is hearted yet."""
    if exclude is None:
        exclude_norm = set()
    else:
        exclude_paths = {exclude} if isinstance(exclude, str) else set(exclude)
        exclude_norm = {os.path.normpath(p).lower() for p in exclude_paths if p}

    pool = [
        r for r in db.hearted_videos(None if folder == FAVORITES_FOLDER else folder)
        if os.path.normpath(r["video_path"]).lower() not in exclude_norm
    ]
    if pool:
        return random.choices([r["video_path"] for r in pool], weights=[r["heart_count"] ** 0.5 for r in pool], k=1)[0]

    # Fetch extra headroom past `offset` so there's enough to skip past any
    # excluded videos and still land on a real pick.
    limit = offset + 1 + len(exclude_norm)
    rows = db.favorite_top_videos(limit) if folder == FAVORITES_FOLDER else db.top_videos_by_reward(folder, limit=limit)
    candidates = [r for r in rows if os.path.normpath(r).lower() not in exclude_norm]
    if offset < len(candidates):
        return candidates[offset]
    return candidates[-1] if candidates else None


def reward_video(db: Database, config: Config, path: Optional[str], reward: float, played: bool = False):
    if not path:
        return
    db.apply_video_reward(path, reward, config.decay_halflife_s, config.reward_ema_alpha, played=played)


def pick_double_feature_pair(db: Database, exclude: Union[str, Iterable[str], None] = None) -> Optional[list]:
    """Two favorited videos to show together - paired by shared Favorites
    membership (both things you've hearted) rather than needing real
    folders to point them at each other."""
    exclude_paths = set() if not exclude else ({exclude} if isinstance(exclude, str) else set(exclude))
    return db.random_favorite_pair(exclude_paths)


def pick_unplayed_video(db: Database, folder: Optional[str] = None) -> Optional[str]:
    """True Mystery Tile: a clip that's never been shown by rotation at
    all, not just an ordinary low-reward/rarely-played pick - deliberately
    searches the whole library (folder=None) rather than just the current
    folder, since "something you've truly never seen" shouldn't be scoped
    to whatever's rotating today."""
    return db.random_unplayed_video(folder)


def fresh_video_paths(db: Database) -> List[str]:
    """Clips waiting on their Fresh Drop debut, oldest arrival first."""
    return db.fresh_video_paths()


def pick_fresh_video(db: Database) -> Optional[str]:
    paths = db.fresh_video_paths()
    return paths[0] if paths else None


def mark_played(db: Database, path: Optional[str]):
    if path:
        db.mark_played(path)


def mark_debuted(db: Database, path: str):
    db.mark_debuted(path)


def bump_loop_anchor(db: Database, path: Optional[str], position: Optional[float]) -> Optional[dict]:
    """Widen `path`'s hearted-position range to include `position`
    (seconds into the clip) - feeds Custom Loop Point, which computes
    the actual loop window client-side (it's the only side that knows
    the clip's duration) from whatever range this has accumulated."""
    if not path or position is None or position < 0:
        return None
    return db.bump_loop_anchor(path, position)


def get_loop_anchor(db: Database, path: Optional[str]) -> Optional[dict]:
    if not path:
        return None
    return db.get_loop_anchor(path)


def get_video_meta(db: Database, path: Optional[str]) -> dict:
    """heart_count + loop_anchor for one specific clip, in one lookup -
    feeds both Custom Loop Point and Featured Tile from the single
    request a tile already makes when its clip changes."""
    if not path:
        return {"heart_count": 0, "loop_anchor": None}
    return db.get_video_meta(path)


def heart_video(db: Database, path: Optional[str], amount: int = 1) -> Optional[dict]:
    """Register a heart (upvote) on `path`, separate from the EMA reward
    update - this tracks count/first/last timestamps for features that key
    off heart history specifically (Heart Streak Badge, Custom Loop Point).
    `amount` lets Hold-to-Heart register a stronger press than a quick tap."""
    if not path:
        return None
    return db.bump_heart(path, amount=amount)
