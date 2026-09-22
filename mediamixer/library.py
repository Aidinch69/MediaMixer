"""Filesystem discovery and reward-weighted picking of folders/videos."""
from __future__ import annotations

import os
import time
from typing import Iterable, List, Optional, Union

from .bandit import decayed_value, exploration_score, softmax_pick
from .config import Config
from .db import Database

# Videos dropped directly in media_dir (not sorted into a category folder) are
# grouped under this implicit folder, so the per-category rotation/weighting
# system still works without forcing the user to pre-sort their library.
GENERAL_FOLDER = "General"


def _loose_video_files(config: Config) -> List[str]:
    return [
        f
        for f in os.listdir(config.media_dir)
        if os.path.isfile(os.path.join(config.media_dir, f)) and f.lower().endswith(config.video_exts)
    ]


def sync_library(db: Database, config: Config) -> List[str]:
    """Scan the media directory and register any new folders/videos with the DB."""
    os.makedirs(config.media_dir, exist_ok=True)
    os.makedirs(config.audio_dir, exist_ok=True)
    folders = list_folders(config)
    for folder in folders:
        db.ensure_folder(folder)
        fdir = config.media_dir if folder == GENERAL_FOLDER else os.path.join(config.media_dir, folder)
        for entry in os.listdir(fdir):
            full = os.path.join(fdir, entry)
            if os.path.isfile(full) and entry.lower().endswith(config.video_exts):
                db.ensure_video(full, folder)
    db.commit()
    return folders


def list_folders(config: Config) -> List[str]:
    if not os.path.isdir(config.media_dir):
        return []
    folders = sorted(
        f
        for f in os.listdir(config.media_dir)
        if os.path.isdir(os.path.join(config.media_dir, f)) and not f.startswith("_")
    )
    if GENERAL_FOLDER not in folders and _loose_video_files(config):
        folders.insert(0, GENERAL_FOLDER)
    return folders


def pick_folder(db: Database, config: Config, exclude: Optional[str] = None) -> Optional[str]:
    now = time.time()
    rows = db.folder_rewards()
    candidates = [r for r in rows if r["folder_name"] != exclude] or rows
    if not candidates:
        return None
    items = [r["folder_name"] for r in candidates]
    scores = [decayed_value(r["ema_reward"], r["updated_at"], now, config.decay_halflife_s) for r in candidates]
    return softmax_pick(items, scores, config.softmax_temp)


def pick_video(
    db: Database, config: Config, folder: str, exclude: Union[str, Iterable[str], None] = None
) -> Optional[str]:
    """Pick a video from `folder`, avoiding `exclude` (one path, or any collection of
    paths - e.g. every video currently showing on another screen, so the same clip
    doesn't end up playing simultaneously in two tiles)."""
    now = time.time()
    rows = db.video_rewards(folder)
    if not rows:
        return None
    if exclude:
        exclude_paths = {exclude} if isinstance(exclude, str) else set(exclude)
        excluded_norm = {os.path.normpath(p).lower() for p in exclude_paths if p}
        rows = [r for r in rows if os.path.normpath(r["video_path"]).lower() not in excluded_norm] or rows
    items = [r["video_path"] for r in rows]
    scores = [
        exploration_score(
            decayed_value(r["ema_reward"], r["updated_at"], now, config.decay_halflife_s),
            r["play_count"],
            config.exploration_bonus_c,
        )
        for r in rows
    ]
    return softmax_pick(items, scores, config.softmax_temp)


def pick_video_jackpot(db: Database, folder: str, offset: int = 0) -> Optional[str]:
    return db.top_video_by_reward(folder, offset)


def reward_video(db: Database, config: Config, path: Optional[str], reward: float, played: bool = False):
    if not path:
        return
    db.apply_video_reward(path, reward, config.decay_halflife_s, config.reward_ema_alpha, played=played)
