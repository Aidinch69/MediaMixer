import os
import subprocess
import time

import pytest

from mediamixer import library, prepare, proxy, sources
from conftest import make_clips


def test_claim_is_exclusive_but_recovers_from_a_stale_tmp(tmp_path):
    tmp = str(tmp_path / "x.proxy.mp4.tmp")
    assert proxy._claim(tmp)
    assert not proxy._claim(tmp)  # someone's mid-transcode
    old = time.time() - proxy.TMP_STALE_S - 10
    os.utime(tmp, (old, old))
    assert proxy._claim(tmp)  # left behind by a crash


def test_failed_clips_are_not_retried(config, db):
    [clip] = make_clips(config, ["a.mp4"])
    library.sync_library(db, config)
    pp = sources.get(config).proxy_path(clip, "tiles")
    assert [p for _s, p in prepare.missing_proxies(config)] == [pp]
    os.makedirs(os.path.dirname(pp), exist_ok=True)
    open(pp + ".failed", "w").close()
    assert prepare.missing_proxies(config) == []
    assert proxy.ensure_proxy(clip, config) is None


class _FakeDna:
    woken = 0

    def wake(self):
        self.woken += 1


@pytest.mark.skipif(proxy._find_ffmpeg() is None, reason="needs ffmpeg")
def test_watcher_registers_new_clips_builds_proxies_and_wakes_dna(config, db):
    os.makedirs(os.path.join(config.media_dir, "Cat", "deep"))
    clip = os.path.join(config.media_dir, "Cat", "deep", "c.mp4")
    subprocess.run([proxy._find_ffmpeg(), "-y", "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=60", "-t", "2",
                    "-pix_fmt", "yuv420p10le", "-c:v", "libx264", clip], check=True, capture_output=True)
    dna = _FakeDna()
    prepare.LibraryWatcher(db, config, dna)._pass()
    assert library.list_folders(config) == ["Cat"]
    assert dna.woken == 1
    assert os.path.isfile(sources.get(config).proxy_path(clip, "tiles"))


@pytest.mark.skipif(proxy._find_ffmpeg() is None, reason="needs ffmpeg")
def test_old_ten_bit_proxies_are_replaced_once(config):
    ff = proxy._find_ffmpeg()
    folder = os.path.join(config.proxy_dir, "abcd1234")
    os.makedirs(folder)
    good, bad = os.path.join(folder, "good.proxy.mp4"), os.path.join(folder, "bad.proxy.mp4")
    for path, fmt in ((good, "yuv420p"), (bad, "yuv420p10le")):
        subprocess.run([ff, "-y", "-f", "lavfi", "-i", "testsrc2=size=160x120", "-t", "1", "-pix_fmt", fmt,
                        "-c:v", "libx264", "-f", "mp4", path], check=True, capture_output=True)
    assert proxy.recheck_old_proxies(ff, config) == 1
    assert os.path.isfile(good) and not os.path.isfile(bad)
    subprocess.run([ff, "-y", "-f", "lavfi", "-i", "testsrc2=size=160x120", "-t", "1", "-pix_fmt", "yuv420p10le",
                    "-c:v", "libx264", "-f", "mp4", bad], check=True, capture_output=True)
    assert proxy.recheck_old_proxies(ff, config) == 0  # only ever once per proxy folder
