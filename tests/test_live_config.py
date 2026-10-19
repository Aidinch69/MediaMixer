import json

import pytest

from mediamixer import live_config
from mediamixer.config import Config


@pytest.fixture
def overrides(tmp_path, monkeypatch):
    path = tmp_path / "overrides.json"
    monkeypatch.setattr(live_config, "OVERRIDES_PATH", str(path))
    return path


def test_set_applies_and_persists(overrides):
    cfg = Config()
    lc = live_config.LiveConfig(cfg)
    assert lc.set("softmax_temp", 1.2) == 1.2
    assert cfg.softmax_temp == 1.2
    assert json.loads(overrides.read_text()) == {"softmax_temp": 1.2}


def test_overrides_survive_restart(overrides):
    live_config.LiveConfig(Config()).set("jackpot_probability", 0.5)
    fresh = Config()
    live_config.LiveConfig(fresh)
    assert fresh.jackpot_probability == 0.5


def test_rejects_out_of_range_and_unknown(overrides):
    lc = live_config.LiveConfig(Config())
    with pytest.raises(ValueError):
        lc.set("softmax_temp", 99)
    with pytest.raises(KeyError):
        lc.set("media_dir", 1)


def test_int_fields_stay_int(overrides):
    cfg = Config()
    live_config.LiveConfig(cfg).set("barrage_check_every_ticks", 7.6)
    assert cfg.barrage_check_every_ticks == 8
    assert isinstance(cfg.barrage_check_every_ticks, int)


def test_setting_back_to_default_drops_override(overrides):
    cfg = Config()
    lc = live_config.LiveConfig(cfg)
    default = cfg.softmax_temp
    lc.set("softmax_temp", 1.0)
    lc.set("softmax_temp", default)
    assert json.loads(overrides.read_text()) == {}


def test_bad_saved_values_are_ignored(overrides):
    overrides.write_text(json.dumps({"softmax_temp": 999, "not_a_field": 1, "jackpot_probability": 0.4}))
    cfg = Config()
    live_config.LiveConfig(cfg)
    assert cfg.softmax_temp == Config().softmax_temp
    assert cfg.jackpot_probability == 0.4


def test_every_live_field_exists_on_config():
    names = set(Config.__dataclass_fields__)
    assert set(live_config.LIVE_FIELDS) <= names
