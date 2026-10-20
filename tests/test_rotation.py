import dataclasses

from conftest import make_clips
from mediamixer import library
from mediamixer.rotation import RotationEngine
from mediamixer.state import RuntimeState


def barrage_start_times(config, db, cooldown_s, seconds=300):
    """Tick the barrage roller at certain-odds for `seconds` of fake time;
    return when each barrage started."""
    cfg = dataclasses.replace(config, barrage_cooldown_s=cooldown_s)
    make_clips(cfg, [f"{i}.mp4" for i in range(4)])
    library.sync_library(db, cfg)
    state = RuntimeState(cfg)
    state.set_intensity(1.0, 0.0)
    engine = RotationEngine(state, db, cfg)
    starts = []

    def fake_start(now):
        starts.append(now)
        state.start_barrage_hype(20, (1.0, 1.0), [0], "small")  # 10s of hype at 0.5s ticks

    engine._start_barrage = fake_start
    now = 1000.0
    while now < 1000.0 + seconds:
        engine._tick_barrage(now)
        now += 0.5
    return starts


def test_barrages_rest_between_runs(config, db):
    starts = barrage_start_times(config, db, cooldown_s=60)
    gaps = [b - a for a, b in zip(starts, starts[1:])]
    assert len(starts) >= 3
    # 10s of hype + 60s rest + up to one 3s check interval.
    assert all(70 <= g <= 74 for g in gaps), gaps


def test_zero_cooldown_allows_back_to_back(config, db):
    starts = barrage_start_times(config, db, cooldown_s=0)
    gaps = [b - a for a, b in zip(starts, starts[1:])]
    assert max(gaps) < 15


def test_layout_change_keeps_surviving_clips(config, db):
    make_clips(config, [f"{i}.mp4" for i in range(20)])
    library.sync_library(db, config)
    state = RuntimeState(config)
    engine = RotationEngine(state, db, config)

    engine.set_layout_and_rotate("grid2x2")
    four = state.current_paths()
    assert len(four) == 4 and all(four) and len(set(four)) == 4

    engine.set_layout_and_rotate("grid2x3")
    six = state.current_paths()
    assert six[:4] == four  # surviving tiles keep playing
    assert all(six) and len(set(six)) == 6  # new ones filled, no duplicates

    engine.set_layout_and_rotate("dual")
    assert state.current_paths() == six[:2]


def test_recently_shown_clips_are_not_repicked(config, db):
    make_clips(config, [f"{i}.mp4" for i in range(12)])
    library.sync_library(db, config)
    state = RuntimeState(config)
    engine = RotationEngine(state, db, config)
    engine.set_layout_and_rotate("dual")
    seen = list(state.current_paths())
    for _ in range(5):  # 10 more picks on 2 tiles: 12 clips total, so no repeats possible yet
        engine.rotate(side="all")
        seen += state.current_paths()
    assert len(seen) == len(set(seen)) == 12
    engine.rotate(side="all")  # pool exhausted: falls back instead of going blank
    assert all(state.current_paths())


def test_repeat_window_zero_disables_memory(config, db):
    cfg = dataclasses.replace(config, recent_repeat_window_s=0)
    make_clips(cfg, ["a.mp4", "b.mp4", "c.mp4"])
    library.sync_library(db, cfg)
    state = RuntimeState(cfg)
    assert state.recent_paths(0) == set()


def test_pinned_tile_keeps_its_clip(config, db):
    make_clips(config, [f"{i}.mp4" for i in range(20)])
    library.sync_library(db, config)
    state = RuntimeState(config)
    engine = RotationEngine(state, db, config)
    engine.set_layout_and_rotate("grid2x2")
    pinned_clip = state.current_paths()[1]
    state.set_pinned(1, True)
    for _ in range(3):
        engine.rotate(side="all")  # e.g. Skip All / folder change
        engine.rotate(side=1)  # e.g. the clip ending on its own
    with state._lock:
        for s in state.screens:
            s.expires_at = 0  # every timer due
    engine.tick()
    assert state.current_paths()[1] == pinned_clip
    assert all(p != pinned_clip for i, p in enumerate(state.current_paths()) if i != 1)
    state.set_pinned(1, False)
    engine.rotate(side=1)
    assert state.current_paths()[1] != pinned_clip
