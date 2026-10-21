import json
import time

from mediamixer import insights


def _log(db, session, events):
    db.add_events(session, [(t, k, json.dumps(d) if d is not None else None) for t, k, d in events])


def _busy_session(t0, minutes=30):
    """A session where RGB split and The Drop clearly draw hearts."""
    evs = [(t0, "page.load", {}), (t0 + 1, "layout.start", {"v": "grid2x2"})]
    end = t0 + minutes * 60
    t = t0 + 2
    while t < end:
        evs.append((t, "autopilot.tick", {}))
        t += 10
    # Baseline: a heart every 20s with no effect on the tile.
    for k in range(int(minutes * 3)):
        evs.append((t0 + 5 + k * 20, "rate", {"dir": "up", "fx": None, "tiles": 4, "clip": f"/m/{k % 40}.mp4", "states": []}))
    # RGB split for 8s every minute, with 3 hearts each time.
    for m in range(minutes):
        s = t0 + 30 + m * 60
        evs.append((s, "fx.tile", {"tile": 0, "kind": "rgb", "ms": 8000}))
        for j in range(3):
            evs.append((s + 1 + j * 2, "rate", {"dir": "up", "fx": "rgb", "tiles": 4, "clip": "/m/favourite.mp4", "states": []}))
    # A Drop every 5 minutes, followed by a burst of hearts.
    for m in range(0, minutes, 5):
        s = t0 + 200 + m * 60
        evs.append((s, "moment.start", {"v": "drop"}))
        evs.append((s + 6, "moment.end", {"v": "drop", "ms": 6000}))
        for j in range(5):
            evs.append((s + 2 + j * 3, "rate", {"dir": "up", "fx": None, "tiles": 4, "clip": "/m/x.mp4", "states": []}))
    return sorted(evs, key=lambda e: e[0])


def test_session_recap_reads_back_the_visit(db):
    t0 = time.time() - 3600
    _log(db, "s1", _busy_session(t0))
    recap = insights.session_recap(db, "s1", t0 - 1)
    labels = {line["label"]: line["value"] for line in recap["lines"]}
    assert recap["likes"] > 100 and 25 <= recap["active_min"] <= 31
    assert recap["top_clips"][0]["name"] == "favourite"
    assert "RGB split" in labels["Effect that landed"]
    assert "The Drop" in labels["Moments"] and "Peak" in labels


def test_insights_find_the_lifts_and_skip_test_runs(db):
    t0 = time.time() - 7200
    _log(db, "real", _busy_session(t0))
    # A short test run full of Drops with no hearts must not drag Drop down.
    _log(db, "test", [(t0 + k, "moment.start", {"v": "drop"}) for k in range(0, 60, 10)])
    items = insights.insights(db)
    texts = " | ".join(i["text"] for i in items)
    assert "RGB split" in texts and "more hearts" in texts
    assert "faster in the 20s after The Drop" in texts
    assert "doesn't seem to grab you" not in texts


def test_insights_stay_quiet_without_enough_data(db):
    _log(db, "tiny", [(time.time() - 100, "rate", {"dir": "up", "fx": "rgb"}), (time.time() - 90, "fx.tile", {"kind": "rgb"})])
    assert insights.insights(db) == []
