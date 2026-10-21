"""Plain-language reading of the event log: a recap of one visit, and
all-time insights (what lifts your hearts, when, and in what kind of session).

Everything here reads the `events` table that dashboard_telemetry.js writes
(rate events carry what was on screen; watchers log <name>.start/.change/.end).
Likes are compared per active minute (or per tile-minute for tile effects),
so something that is simply on screen a lot doesn't look loved just for
being around.
"""

import json
import math
import os
import time
from collections import Counter, defaultdict

from . import library

ACTIVE_GAP_CAP_S = 300  # a quiet gap longer than this counts as away
MOMENT_WINDOW_S = 20  # hearts this soon after a moment count toward it
LAYOUT_TILES = {"dual": 2, "grid2x2": 4, "grid3x3": 9, "grid4x4": 16}
FX_DEFAULT_MS = 7500
FX_LABELS = {"rgb": "RGB split", "vhs": "VHS", "zoom": "Zoom pulse", "leak": "Light leaks", "prism": "Prism", "bloom": "Bloom", "duotone": "Duotone"}
# All-time insights skip visits too short or quiet to say anything (and test runs).
MIN_SESSION_ACTIVE_S = 300
MIN_SESSION_LIKES = 10
MOMENT_LABELS = {
    "drop": "The Drop", "breath": "a Breath", "focus": "a Focus pull", "callResponse": "Call & response",
    "echo": "Echo trails", "favorite": "a Favourite takeover", "split": "Split frames",
}
TIME_BUCKETS = (("late night", range(0, 5)), ("morning", range(5, 12)), ("afternoon", range(12, 17)), ("evening", range(17, 22)), ("late night", range(22, 24)))


def _rows(db, since_ts: float, session: str = None) -> dict:
    """{session: [(ts, kind, data), ...]} oldest first."""
    out = defaultdict(list)
    for r in db.events_since(since_ts, session):
        try:
            data = json.loads(r["data"]) if r["data"] else {}
        except ValueError:
            data = {}
        out[r["session"]].append((r["ts"], r["kind"], data if isinstance(data, dict) else {}))
    return out


def _likes(evs):
    return [(t, d) for t, k, d in evs if k == "rate" and d.get("dir") == "up"]


def _active_spans(evs):
    """(start, end) of each stretch of activity, gaps over the cap cut out."""
    spans = []
    for (t0, _k, _d), (t1, _k1, _d1) in zip(evs, evs[1:]):
        if t1 - t0 <= ACTIVE_GAP_CAP_S:
            spans.append((t0, t1))
    return spans


def _active_s(evs):
    return sum(b - a for a, b in _active_spans(evs))


def _intervals(evs, name):
    """(start, end, value) for one telemetry watcher; a page load closes it."""
    out, cur, start, last = [], None, 0.0, evs[-1][0] if evs else 0.0
    for t, k, d in evs:
        if k == name + ".start":
            if cur is not None:
                out.append((start, t, cur))
            cur, start = d.get("v"), t
        elif k == name + ".change":
            if cur is not None:
                out.append((start, t, cur))
            cur, start = d.get("to"), t
        elif k == name + ".end" or (k == "page.load" and cur is not None):
            if cur is not None:
                out.append((start, t, cur))
            cur = None
    if cur is not None:
        out.append((start, last, cur))
    return out


def _overlap_active(spans, a, b):
    return sum(max(0.0, min(b, y) - max(a, x)) for x, y in spans)


def _tiles_at(layouts, t, default):
    for a, b, v in layouts:
        if a <= t <= b:
            return LAYOUT_TILES.get(v, default)
    return default


def _moment_starts(evs):
    """(t, moment name) for every structured moment that began."""
    out = []
    for t, k, d in evs:
        if k == "moment.start" and d.get("v") in MOMENT_LABELS:
            out.append((t, d["v"]))
        elif k == "moment.change" and d.get("to") in MOMENT_LABELS:
            out.append((t, d["to"]))
        elif k == "splitFrames.start":
            out.append((t, "split"))
    return out


def _fx_label(kind):
    return FX_LABELS.get(kind, kind.capitalize())


def _clip_name(path):
    return os.path.splitext(os.path.basename(path or ""))[0] or "?"


def _fx_stats(evs, spans, likes):
    """{kind: (likes, tile_s)} plus ('', ...) for no effect."""
    layouts = _intervals(evs, "layout")
    default_tiles = next((d.get("tiles") for _t, d in reversed(likes) if d.get("tiles")), 4)
    total_tile_s = sum((b - a) * _tiles_at(layouts, a, default_tiles) for a, b in spans)
    exposure = Counter()
    for t, k, d in evs:
        if k == "fx.tile" and d.get("kind") and d.get("kind") != "shock":
            exposure[d["kind"]] += (d.get("ms") or FX_DEFAULT_MS) / 1000.0
    liked = Counter(d.get("fx") or "" for _t, d in likes if "fx" in d)
    stats = {kind: (liked[kind], s) for kind, s in exposure.items()}
    stats[""] = (liked[""], max(0.0, total_tile_s - sum(exposure.values())))
    return stats


def _lift(n_in, s_in, n_all, s_all):
    """Like rate inside vs outside, or None when there isn't enough to say."""
    n_out, s_out = n_all - n_in, s_all - s_in
    if s_in <= 0 or s_out <= 0 or n_out <= 0:
        return None
    return (n_in / s_in) / (n_out / s_out)


# ---- one visit ----
def session_recap(db, session: str, since_ts: float) -> dict:
    evs = _rows(db, since_ts, session).get(session, [])
    likes = _likes(evs)
    spans = _active_spans(evs)
    active_s = sum(b - a for a, b in spans)
    dislikes = sum(1 for _t, k, d in evs if k == "rate" and d.get("dir") != "up")
    lines = []
    clips = Counter(d.get("clip") for _t, d in likes if d.get("clip"))
    top = [{"name": _clip_name(p), "path": p, "hearts": n} for p, n in clips.most_common(3) if n >= 2]
    if top:
        lines.append({"icon": "👑", "label": "Favourite clip", "value": top[0]["name"] + " (❤️ x" + str(top[0]["hearts"]) + ")"})
    # Busiest two minutes for hearts.
    if len(likes) >= 5:
        times = [t for t, _d in likes]
        best, best_at, j = 0, times[0], 0
        for i, t in enumerate(times):
            while times[j] < t - 120:
                j += 1
            if i - j + 1 > best:
                best, best_at = i - j + 1, times[j]
        lines.append({"icon": "🔥", "label": "Peak", "value": str(best) + " hearts in 2 min, " + str(int((best_at - evs[0][0]) // 60)) + " min in"})
    fx = _fx_stats(evs, spans, likes)
    n_all = sum(n for n, _s in fx.values())
    s_all = sum(s for _n, s in fx.values())
    best_fx = None
    for kind, (n, s) in fx.items():
        lift = _lift(n, s, n_all, s_all) if kind else None
        if kind and n >= 3 and lift and lift > 1.1 and (not best_fx or lift > best_fx[1]):
            best_fx = (kind, lift)
    if best_fx:
        lines.append({"icon": "🎨", "label": "Effect that landed", "value": _fx_label(best_fx[0]) + " (hearts x" + format(best_fx[1], ".1f") + ")"})
    patterns = Counter(d.get("rhythmPattern") for _t, d in likes if d.get("rhythmPattern"))
    if patterns and patterns.most_common(1)[0][1] >= 3:
        lines.append({"icon": "🥁", "label": "Beat pattern", "value": patterns.most_common(1)[0][0].capitalize()})
    moments = _moment_starts(evs)
    if moments:
        counts = Counter(m for _t, m in moments)
        after = Counter()
        for t, m in moments:
            after[m] += sum(1 for lt, _d in likes if t <= lt <= t + MOMENT_WINDOW_S)
        star = max(counts, key=lambda m: after[m] / counts[m])
        value = ", ".join(MOMENT_LABELS[m].replace("a ", "", 1) + (" x" + str(n) if n > 1 else "") for m, n in counts.most_common(4))
        lines.append({"icon": "🎆", "label": "Moments", "value": value})
        if after[star] >= 2:
            lines.append({"icon": "💘", "label": "Hit hardest", "value": MOMENT_LABELS[star].replace("a ", "", 1) + " (" + str(after[star]) + " hearts right after)"})
    return {
        "active_min": round(active_s / 60, 1),
        "likes": len(likes),
        "dislikes": dislikes,
        "per_min": round(len(likes) / (active_s / 60), 2) if active_s >= 60 else None,
        "top_clips": top,
        "lines": lines,
    }


# ---- all time ----
def insights(db, days: float = 14) -> list:
    """Plain-language findings, strongest first. Only says something when
    there's enough behind it."""
    by_session = _rows(db, time.time() - days * 86400)
    found = []

    def add(icon, text, lift, weight):
        found.append({"icon": icon, "text": text, "lift": round(lift, 2), "score": abs(math.log(lift)) * min(1.0, weight)})

    # Clip DNA: hearts per play by trait third (all-time, from video_weights).
    taste = library.dna_taste(db, max_age_s=0)
    if taste:
        for trait, (low, high) in library.DNA_TASTE_TRAITS.items():
            lo, _mid, hi = taste[trait]["lifts"]
            ratio = lo / hi
            if ratio >= 1.25:
                add("🧬", f"You heart {low} clips {ratio:.1f}x more than {high} ones, per play.", ratio, 1)
            elif ratio <= 0.8:
                add("🧬", f"You heart {high} clips {1 / ratio:.1f}x more than {low} ones, per play.", 1 / ratio, 1)

    fx_n, fx_s = Counter(), Counter()
    moment_n, moment_hits = Counter(), Counter()
    bucket_likes, bucket_s = Counter(), Counter()
    intent_likes, intent_s = Counter(), Counter()
    pattern_likes, pattern_s = Counter(), Counter()
    total_likes, total_s = 0, 0.0
    for evs in by_session.values():
        if len(evs) < 2 or any(k == "session.open" and d.get("automated") for _t, k, d in evs):
            continue
        likes = _likes(evs)
        spans = _active_spans(evs)
        active_s = sum(b - a for a, b in spans)
        if active_s < MIN_SESSION_ACTIVE_S or len(likes) < MIN_SESSION_LIKES:
            continue
        total_likes += len(likes)
        total_s += active_s
        for kind, (n, s) in _fx_stats(evs, spans, likes).items():
            fx_n[kind] += n
            fx_s[kind] += s
        for t, m in _moment_starts(evs):
            moment_n[m] += 1
            moment_hits[m] += sum(1 for lt, _d in likes if t <= lt <= t + MOMENT_WINDOW_S)
        for a, b in spans:
            hour = time.localtime(a).tm_hour
            bucket_s[next(name for name, hours in TIME_BUCKETS if hour in hours)] += b - a
        for t, _d in likes:
            hour = time.localtime(t).tm_hour
            bucket_likes[next(name for name, hours in TIME_BUCKETS if hour in hours)] += 1
        # Session intent: everything after a pick until the next page load.
        intent, seg_start = None, None
        marks = [(t, k, d) for t, k, d in evs if k in ("session.intent", "page.load")] + [(evs[-1][0], "end", {})]
        for t, k, d in marks:
            if intent and seg_start is not None:
                intent_s[intent] += _overlap_active(spans, seg_start, t)
                intent_likes[intent] += sum(1 for lt, _d in likes if seg_start <= lt < t)
            intent, seg_start = (d.get("intent"), t) if k == "session.intent" else (None, None)
        for a, b, p in _intervals(evs, "rhythmPattern"):
            pattern_s[p] += _overlap_active(spans, a, b)
        for _t, d in likes:
            if d.get("rhythmPattern"):
                pattern_likes[d["rhythmPattern"]] += 1
    if total_s < 600 or total_likes < 20:
        return sorted(found, key=lambda f: -f["score"])

    base = total_likes / total_s
    all_n, all_s = sum(fx_n.values()), sum(fx_s.values())
    for kind in fx_s:
        if not kind or fx_n[kind] < 10:
            continue
        lift = _lift(fx_n[kind], fx_s[kind], all_n, all_s)
        if lift and (lift >= 1.25 or lift <= 0.8):
            more = "more" if lift > 1 else "less"
            add("🎨", f"Tiles with {_fx_label(kind)} on get {max(lift, 1 / lift):.1f}x {more} hearts than the rest.", lift, fx_n[kind] / 30)
    for m, n in moment_n.items():
        if n < 3:
            continue
        lift = (moment_hits[m] / (n * MOMENT_WINDOW_S)) / base
        if lift >= 1.25 or lift <= 0.8:
            name = MOMENT_LABELS[m]
            if lift > 1:
                add("🎆", f"Hearts come {lift:.1f}x faster in the {MOMENT_WINDOW_S}s after {name}.", lift, n / 8)
            else:
                add("🎆", f"{name[0].upper() + name[1:]} doesn't seem to grab you - hearts slow to {lift:.1f}x right after.", lift, n / 8)
    rated = [(b, bucket_likes[b] / bucket_s[b]) for b in bucket_s if bucket_s[b] >= 1200]
    if len(rated) >= 2:
        best, rate = max(rated, key=lambda x: x[1])
        others_l = sum(bucket_likes[b] for b, _r in rated if b != best)
        others_s = sum(bucket_s[b] for b, _r in rated if b != best)
        lift = rate / (others_l / others_s) if others_l else None
        if lift and lift >= 1.25:
            add("🕒", f"You're most into it in the {best} - {lift:.1f}x the hearts per minute of other times.", lift, bucket_s[best] / 3600)
    rated = [(i, intent_likes[i] / intent_s[i]) for i in intent_s if i and intent_s[i] >= 900]
    if len(rated) >= 2:
        best, rate = max(rated, key=lambda x: x[1])
        low, low_rate = min(rated, key=lambda x: x[1])
        if low_rate > 0 and rate / low_rate >= 1.25:
            add("🧭", f"{best.capitalize()} sessions get {rate / low_rate:.1f}x the hearts per minute of {low.capitalize()} ones.", rate / low_rate, 1)
    for p, s in pattern_s.items():
        if s < 300 or pattern_likes[p] < 10:
            continue
        lift = (pattern_likes[p] / s) / base
        if lift >= 1.25:
            add("🥁", f"The {p} beat pattern lifts hearts {lift:.1f}x.", lift, pattern_likes[p] / 30)
    found.sort(key=lambda f: -f["score"])
    per_icon = Counter()
    kept = []
    for f in found:  # no more than 3 of a kind, so effects don't crowd out the rest
        per_icon[f["icon"]] += 1
        if per_icon[f["icon"]] <= 3:
            kept.append(f)
    return kept[:8]
