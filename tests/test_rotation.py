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
