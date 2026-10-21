import os

import pytest

from mediamixer import library, sources
from conftest import make_clips


def _clip(base, *parts):
    path = os.path.join(base, *parts)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    open(path, "wb").close()
    return path


def test_nested_subfolders_count_toward_their_top_level_category(config, db):
    deep = _clip(config.media_dir, "Beach", "2024", "June", "a.mp4")
    shallow = _clip(config.media_dir, "Beach", "b.mp4")
    loose = _clip(config.media_dir, "c.mp4")
    folders = library.sync_library(db, config)
    assert folders == [library.GENERAL_FOLDER, "Beach"]
    picks = {library.pick_video(db, config, "Beach") for _ in range(100)}
    assert picks == {deep, shallow}
    assert library.pick_video(db, config, library.GENERAL_FOLDER) == loose


def test_underscore_and_proxy_folders_are_skipped(config, db, tmp_path):
    _clip(config.media_dir, "_archive", "old.mp4")
    keep = _clip(config.media_dir, "keep.mp4")
    library.sync_library(db, config)
    assert library.list_all_videos(config) == [sources.get(config).to_rel(keep, "tiles")]


def test_several_folders_feed_one_library(config, db, tmp_path):
    other = tmp_path / "second_library"
    a = _clip(config.media_dir, "Cats", "a.mp4")
    b = _clip(str(other), "Cats", "nested", "b.mp4")
    c = _clip(str(other), "Dogs", "c.mp4")
    sources.get(config).set_chosen("tiles", [config.media_dir, str(other)])
    assert library.sync_library(db, config) == ["Cats", "Dogs"]
    assert {library.pick_video(db, config, "Cats") for _ in range(100)} == {a, b}
    assert library.pick_video(db, config, "Dogs") == c


def test_rel_paths_round_trip_and_reject_escapes(config, db):
    path = _clip(config.media_dir, "Sub", "deep", "x y.mp4")
    src = sources.get(config)
    rel = src.to_rel(path, "tiles")
    assert rel.split("/", 1)[1] == "Sub/deep/x y.mp4"
    assert src.to_abs("tiles", rel) == path
    rid = rel.split("/", 1)[0]
    assert src.to_abs("tiles", rid + "/../secret.mp4") == ""
    assert src.to_abs("tiles", "deadbeef/Sub/deep/x y.mp4") == ""


def test_removed_folder_sits_out_but_keeps_its_history(config, db, tmp_path):
    other = tmp_path / "usb"
    keep = _clip(config.media_dir, "a.mp4")
    gone = _clip(str(other), "b.mp4")
    src = sources.get(config)
    src.set_chosen("tiles", [config.media_dir, str(other)])
    library.sync_library(db, config)
    library.heart_video(db, gone)

    src.set_chosen("tiles", [config.media_dir])
    library.sync_library(db, config)
    assert {library.pick_video(db, config, library.GENERAL_FOLDER) for _ in range(50)} == {keep}
    assert not db.has_favorites()

    src.set_chosen("tiles", [config.media_dir, str(other)])
    library.sync_library(db, config)
    assert db.has_favorites()


def test_a_newly_added_folder_is_not_held_back_as_fresh(config, db, tmp_path):
    make_clips(config, ["a.mp4"])
    library.sync_library(db, config)
    other = tmp_path / "new_source"
    _clip(str(other), "b.mp4")
    sources.get(config).set_chosen("tiles", [config.media_dir, str(other)])
    library.sync_library(db, config)
    assert library.fresh_video_paths(db) == []
    # ...but a clip that later turns up inside it is.
    late = _clip(str(other), "c.mp4")
    library.sync_library(db, config)
    assert library.fresh_video_paths(db) == [late]


def test_proxies_are_namespaced_per_source_folder(config, tmp_path):
    other = tmp_path / "second"
    a = _clip(config.media_dir, "same.mp4")
    b = _clip(str(other), "same.mp4")
    src = sources.get(config)
    src.set_chosen("tiles", [config.media_dir, str(other)])
    pa, pb = src.proxy_path(a, "tiles"), src.proxy_path(b, "tiles")
    assert pa != pb
    assert pa.startswith(os.path.abspath(config.proxy_dir))


def test_set_chosen_rejects_missing_folders(config, tmp_path):
    with pytest.raises(ValueError):
        sources.get(config).set_chosen("tiles", [str(tmp_path / "nope")])
