import random
from collections import Counter

from mediamixer import library
from conftest import make_clips


def test_loose_files_are_grouped_into_general(config, db):
    make_clips(config, ["a.mp4", "b.mp4", "notes.txt"])
    folders = library.sync_library(db, config)
    assert library.GENERAL_FOLDER in folders
    assert db.video_count() == 2


def test_first_scan_is_not_fresh_but_later_additions_are(config, db):
    make_clips(config, ["a.mp4", "b.mp4"])
    library.sync_library(db, config)
    assert library.fresh_video_paths(db) == []

    [new] = make_clips(config, ["new.mp4"])
    library.sync_library(db, config)
    assert library.fresh_video_paths(db) == [new]
    # Fresh clips stay out of normal rotation until Fresh Drop debuts them.
    picks = {library.pick_video(db, config, library.GENERAL_FOLDER) for _ in range(200)}
    assert new not in picks

    library.mark_debuted(db, new)
    assert library.fresh_video_paths(db) == []


def test_pick_video_honours_exclude(config, db):
    paths = make_clips(config, ["a.mp4", "b.mp4", "c.mp4"])
    library.sync_library(db, config)
    for _ in range(100):
        assert library.pick_video(db, config, library.GENERAL_FOLDER, exclude=paths[:2]) == paths[2]


def test_rewarded_clip_is_picked_more_often(config, db):
    paths = make_clips(config, [f"{i}.mp4" for i in range(5)])
    library.sync_library(db, config)
    for _ in range(5):
        library.reward_video(db, config, paths[0], 1.0)
    random.seed(7)
    counts = Counter(library.pick_video(db, config, library.GENERAL_FOLDER) for _ in range(3000))
    assert counts[paths[0]] == max(counts.values())
    assert len(counts) == 5  # but nothing is starved out entirely


def test_play_count_reduces_exploration_bonus(config, db):
    paths = make_clips(config, ["worn.mp4", "new.mp4"])
    library.sync_library(db, config)
    for _ in range(50):
        library.reward_video(db, config, paths[0], 0.0, played=True)
    random.seed(3)
    counts = Counter(library.pick_video(db, config, library.GENERAL_FOLDER) for _ in range(3000))
    assert counts[paths[1]] > counts[paths[0]]


def test_jackpot_ranking_skips_excluded(config, db):
    paths = make_clips(config, ["a.mp4", "b.mp4", "c.mp4"])
    library.sync_library(db, config)
    library.reward_video(db, config, paths[1], 1.0)
    assert library.pick_video_jackpot(db, library.GENERAL_FOLDER) == paths[1]
    assert library.pick_video_jackpot(db, library.GENERAL_FOLDER, exclude=[paths[1]]) != paths[1]


def test_jackpot_draws_hearted_clips_weighted_by_hearts(config, db):
    paths = make_clips(config, [f"{i:03}.mp4" for i in range(30)])
    library.sync_library(db, config)
    library.heart_video(db, paths[-1], amount=9)
    library.heart_video(db, paths[-2], amount=1)
    random.seed(5)
    counts = Counter(library.pick_video_jackpot(db, library.GENERAL_FOLDER) for _ in range(2000))
    assert set(counts) == {paths[-1], paths[-2]}
    assert counts[paths[-1]] > 5 * counts[paths[-2]]


def test_jackpot_without_hearts_does_not_favor_alphabetical_order(config, db):
    paths = make_clips(config, [f"{i:03}.mp4" for i in range(30)])
    library.sync_library(db, config)
    firsts = {library.pick_video_jackpot(db, library.GENERAL_FOLDER) for _ in range(50)}
    assert len(firsts) > 5


def test_jackpot_batch_never_repeats_a_clip(config, db):
    make_clips(config, [f"{i}.mp4" for i in range(6)])
    library.sync_library(db, config)
    in_use = set()
    for offset in range(6):
        picked = library.pick_video_jackpot(db, library.GENERAL_FOLDER, offset=offset, exclude=in_use)
        assert picked not in in_use
        in_use.add(picked)


def test_hearts_build_favorites(config, db):
    paths = make_clips(config, ["a.mp4", "b.mp4"])
    library.sync_library(db, config)
    assert library.FAVORITES_FOLDER not in library.list_folders_with_favorites(db, config)
    library.heart_video(db, paths[0])
    assert library.FAVORITES_FOLDER in library.list_folders_with_favorites(db, config)
    assert library.pick_video(db, config, library.FAVORITES_FOLDER) == paths[0]
