import os
import random
import subprocess
from collections import Counter

import pytest

from conftest import make_clips
from mediamixer import clip_dna, library
from mediamixer.proxy import _find_ffmpeg

FFMPEG = _find_ffmpeg()
needs_ffmpeg = pytest.mark.skipif(not FFMPEG, reason="ffmpeg not installed")


def synth_clip(path, source):
    subprocess.run([FFMPEG, "-v", "error", "-y", "-f", "lavfi", "-i", source, "-t", "4", "-pix_fmt", "yuv420p", path], check=True)
    return path


@needs_ffmpeg
def test_analyze_reads_colour_brightness_and_motion(config, tmp_path):
    media = config.media_dir
    blue = synth_clip(os.path.join(media, "blue.mp4"), "color=c=0x2040ff:s=320x180:r=10")
    dark = synth_clip(os.path.join(media, "dark.mp4"), "color=c=0x080808:s=320x180:r=10")
    moving = synth_clip(os.path.join(media, "moving.mp4"), "testsrc2=s=320x180:r=10")
    b, d, m = (clip_dna.analyze(p, config) for p in (blue, dark, moving))
    assert 215 <= b["accent_hue"] <= 245 and b["warmth"] < 0  # blue: a cool accent colour
    assert b["motion"] < 0.005 and m["motion"] > 0.02  # a still frame vs a moving test pattern
    assert d["brightness"] < 0.1 < b["brightness"]
    assert 3.5 < b["duration"] < 4.5


def seed(db, config, motions):
    paths = make_clips(config, [f"{i}.mp4" for i in range(len(motions))])
    library.sync_library(db, config)
    for p, mo in zip(paths, motions):
        db.save_dna(p, {"brightness": mo, "motion": mo, "warmth": mo, "hue": 20, "accent_hue": None}, clip_dna.DNA_VERSION)
    return paths


def test_energy_leans_toward_motion(config, db):
    paths = seed(db, config, [0.02] * 9 + [0.12])  # one clip far livelier than the rest
    random.seed(4)
    def share(energy):
        c = Counter(library.pick_video(db, config, library.GENERAL_FOLDER, energy=energy) for _ in range(4000))
        return c[paths[-1]] / 4000
    calm, neutral, hype = share(0.85), share(1.0), share(1.3)
    assert calm < neutral < hype
    assert hype < 0.35  # a lean, not a takeover


def test_gradient_picks_are_ordered(config, db):
    seed(db, config, [i / 40 for i in range(40)])
    picks = library.gradient_picks(db, library.GENERAL_FOLDER, "brightness", 6)
    values = [db.dna_for(p)["brightness"] for p in picks]
    assert len(picks) == 6 == len(set(picks)) and values == sorted(values)
    assert values[0] < 0.25 and values[-1] > 0.7  # spans the range


def test_similar_clips_match_warmth(config, db):
    paths = seed(db, config, [0.05, 0.06, 0.07, 0.30, 0.32, 0.34])
    similar = library.similar_clips(db, paths[0], limit=2)
    assert set(similar) == {paths[1], paths[2]}


def test_missing_dna_queue_and_failures(config, db):
    paths = make_clips(config, ["a.mp4", "b.mp4"])
    library.sync_library(db, config)
    assert set(db.paths_missing_dna(clip_dna.DNA_VERSION)) == set(paths)
    db.save_dna(paths[0], None, clip_dna.DNA_VERSION)  # undecodable: recorded, not retried
    assert db.paths_missing_dna(clip_dna.DNA_VERSION) == [paths[1]]
    assert db.dna_counts() == {"total": 2, "analysed": 0, "failed": 1}


def test_dna_taste_learns_from_hearts_per_play(config, db):
    library._dna_taste_cache.update(at=0, value=None)
    paths = make_clips(config, [f"{i}.mp4" for i in range(60)])
    library.sync_library(db, config)
    for i, p in enumerate(paths):
        motion = i / 60  # first third calm, last third lively
        db.save_dna(p, {"brightness": 0.5, "motion": motion, "warmth": 0.1, "saturation": 0.3}, clip_dna.DNA_VERSION)
        for _ in range(10):
            library.mark_played(db, p)
        if i < 20:
            library.heart_video(db, p, amount=3)  # calm clips get hearted
    taste = library.dna_taste(db, max_age_s=0)
    calm, _mid, lively = taste["motion"]["lifts"]
    assert calm > 1.5 and lively < 0.8
    random.seed(9)
    def calm_share(strength):
        c = Counter(library.pick_video(db, config, library.GENERAL_FOLDER, taste_strength=strength) for _ in range(3000))
        return sum(n for p, n in c.items() if paths.index(p) < 20) / 3000
    assert calm_share(0.0) < calm_share(0.5)
    library._dna_taste_cache.update(at=0, value=None)
