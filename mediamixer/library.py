"""Filesystem discovery and reward-weighted picking of folders/videos."""
from __future__ import annotations

import os
import time
from typing import Iterable, List, Optional, Union

from .bandit import decayed_value, exploration_score, softmax_pick
from .config import Config
from .db import Database

# Videos dropped directly in media_dir (not sorted into a category folder) are
# grouped under this implicit folder, so the per-category rotation/weighting
# system still works without forcing the user to pre-sort their library.
GENERAL_FOLDER = "General"


def _loose_video_files(config: Config) -> List[str]:
    return [
        f
        for f in os.listdir(config.media_dir)
        if os.path.isfile(os.path.join(config.media_dir, f)) and f.lower().endswith(config.video_exts)
    ]


def sync_library(db: Database, config: Config) -> List[str]:
    """Scan the media directory and register any new folders/videos with the DB."""
    os.makedirs(config.media_dir, exist_ok=True)
    os.makedirs(config.audio_dir, exist_ok=True)
    folders = list_folders(config)
    for folder in folders:
        db.ensure_folder(folder)
        fdir = config.media_dir if folder == GENERAL_FOLDER else os.path.join(config.media_dir, folder)
        for entry in os.listdir(fdir):
            full = os.path.join(fdir, entry)
            if os.path.isfile(full) and entry.lower().endswith(config.video_exts):
                db.ensure_video(full, folder)
    db.commit()
    return folders


def list_folders(config: Config) -> List[str]:
    if not os.path.isdir(config.media_dir):
        return []
    folders = sorted(
        f
        for f in os.listdir(config.media_dir)
        if os.path.isdir(os.path.join(config.media_dir, f)) and not f.startswith("_")
    )
    if GENERAL_FOLDER not in folders and _loose_video_files(config):
        folders.insert(0, GENERAL_FOLDER)
    return folders


def list_all_videos(config: Config) -> List[str]:
    """Flat list of every video in the library (all categories plus loose
    top-level files), as paths relative to media_dir. Used by features that
    just want "something from the library" - e.g. the floating overlay FX -
    without the reward-weighted selection machinery."""
    if not os.path.isdir(config.media_dir):
        return []
    results = []
    for folder in list_folders(config):
        fdir = config.media_dir if folder == GENERAL_FOLDER else os.path.join(config.media_dir, folder)
        for entry in sorted(os.listdir(fdir)):
            full = os.path.join(fdir, entry)
            if os.path.isfile(full) and entry.lower().endswith(config.video_exts):
                results.append(os.path.relpath(full, config.media_dir).replace("\\", "/"))
    return results


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
    rows = db.video_rewards(folder)
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
    return softmax_pick(items, scores, config.softmax_temp)


def pick_video_jackpot(
    db: Database, folder: str, offset: int = 0, exclude: Union[str, Iterable[str], None] = None
) -> Optional[str]:
    """Rank-based pick for jackpot mode: the `offset`-th best-reviewed video in
    `folder`, skipping anything in `exclude` (so two screens can't both land on
    the same "top ranked" video in the same jackpot batch)."""
    if exclude is None:
        exclude_norm = set()
    else:
        exclude_paths = {exclude} if isinstance(exclude, str) else set(exclude)
        exclude_norm = {os.path.normpath(p).lower() for p in exclude_paths if p}

    # Fetch extra headroom past `offset` so there's enough to skip past any
    # excluded videos and still land on a real pick.
    rows = db.top_videos_by_reward(folder, limit=offset + 1 + len(exclude_norm))
    candidates = [r for r in rows if os.path.normpath(r).lower() not in exclude_norm]
    if offset < len(candidates):
        return candidates[offset]
    return candidates[-1] if candidates else None


def reward_video(db: Database, config: Config, path: Optional[str], reward: float, played: bool = False):
    if not path:
        return
    db.apply_video_reward(path, reward, config.decay_halflife_s, config.reward_ema_alpha, played=played)


def heart_video(db: Database, path: Optional[str]) -> Optional[dict]:
    """Register a heart (upvote) on `path`, separate from the EMA reward
    update - this tracks count/first/last timestamps for features that key
    off heart history specifically (Heart Streak Badge, Custom Loop Point)."""
    if not path:
        return None
    return db.bump_heart(path)
