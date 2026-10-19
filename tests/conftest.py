import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from mediamixer.config import Config  # noqa: E402
from mediamixer.db import Database  # noqa: E402


@pytest.fixture
def config(tmp_path):
    """A Config pointed entirely at a throwaway directory - never the real library or DB."""
    media = tmp_path / "media"
    media.mkdir()
    return Config(
        media_dir=str(media),
        audio_dir=str(tmp_path / "audio"),
        overlay_fx_dir=str(tmp_path / "fx"),
        spirals_dir=str(tmp_path / "spirals"),
        proxy_dir=str(tmp_path / "proxies"),
        db_path=str(tmp_path / "test.db"),
    )


@pytest.fixture
def db(config):
    database = Database(config)
    yield database
    database.close()


def make_clips(config, names, folder=None):
    """Create empty video files (the library only looks at names/extensions)."""
    base = config.media_dir if folder is None else os.path.join(config.media_dir, folder)
    os.makedirs(base, exist_ok=True)
    paths = []
    for name in names:
        path = os.path.join(base, name)
        open(path, "wb").close()
        paths.append(path)
    return paths
