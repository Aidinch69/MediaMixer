import pytest

from mediamixer.config import Config
from mediamixer.state import RuntimeState


@pytest.mark.parametrize("preset", Config().layout_presets, ids=lambda p: p.name)
def test_every_layout_sizes_the_screen_list(preset):
    state = RuntimeState(Config())
    state.set_layout(preset.name)
    snap = state.snapshot()
    assert snap["layout"] == preset.name
    assert len(snap["screens"]) == preset.tile_count


def test_default_layout_exists():
    cfg = Config()
    assert cfg.default_layout in {p.name for p in cfg.layout_presets}
