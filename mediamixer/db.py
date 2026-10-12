"""SQLite-backed storage for folder/video/audio reward weights.

One connection per thread (SQLite connections aren't thread-safe to share),
WAL mode so the web, rotation and audio threads don't block each other.
"""
from __future__ import annotations

import logging
import sqlite3
import threading
import time

from .bandit import decayed_value
from .config import Config

log = logging.getLogger(__name__)

SCHEMA = """
CREATE TABLE IF NOT EXISTS folder_weights (
    folder_name TEXT PRIMARY KEY,
    ema_reward  REAL NOT NULL DEFAULT 0.0,
    updated_at  REAL NOT NULL DEFAULT 0.0
);
CREATE TABLE IF NOT EXISTS video_weights (
    video_path  TEXT PRIMARY KEY,
    folder_name TEXT NOT NULL,
    ema_reward  REAL NOT NULL DEFAULT 0.0,
    play_count  INTEGER NOT NULL DEFAULT 0,
    updated_at  REAL NOT NULL DEFAULT 0.0
);
CREATE INDEX IF NOT EXISTS idx_video_weights_folder ON video_weights(folder_name);
CREATE TABLE IF NOT EXISTS audio_tracks (
    file_name   TEXT PRIMARY KEY,
    ema_reward  REAL NOT NULL DEFAULT 0.0,
    updated_at  REAL NOT NULL DEFAULT 0.0
);
"""


class Database:
    def __init__(self, config: Config):
        self._path = config.db_path
        self._tls = threading.local()
        with self._connect() as conn:
            conn.executescript(SCHEMA)

    def _connect(self) -> sqlite3.Connection:
        conn = getattr(self._tls, "conn", None)
        if conn is None:
            conn = sqlite3.connect(self._path, check_same_thread=False, timeout=5.0)
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA synchronous=NORMAL")
            conn.row_factory = sqlite3.Row
            self._tls.conn = conn
        return conn

    def close(self):
        conn = getattr(self._tls, "conn", None)
        if conn is not None:
            conn.close()
            self._tls.conn = None

    def commit(self):
        self._connect().commit()

    # -- library sync --
    def ensure_folder(self, name: str):
        self._connect().execute("INSERT OR IGNORE INTO folder_weights(folder_name) VALUES (?)", (name,))

    def ensure_video(self, path: str, folder: str):
        self._connect().execute(
            "INSERT OR IGNORE INTO video_weights(video_path, folder_name) VALUES (?, ?)", (path, folder)
        )

    # -- selection --
    def folder_rewards(self):
        return self._connect().execute("SELECT folder_name, ema_reward, updated_at FROM folder_weights").fetchall()

    def video_rewards(self, folder: str):
        return self._connect().execute(
            "SELECT video_path, ema_reward, play_count, updated_at FROM video_weights WHERE folder_name=?",
            (folder,),
        ).fetchall()

    def top_videos_by_reward(self, folder: str, limit: int) -> list:
        """Top `limit` videos by reward, highest first. `video_path` is a tie
        breaker so the ranking is fully deterministic even among the many
        videos that sit at the same (often 0.0, never-rated) ema_reward -
        without it, separate queries racing against concurrent reward
        updates could rank the same tied video differently from one offset
        to the next, handing two screens the same "top ranked" pick."""
        rows = self._connect().execute(
            "SELECT video_path FROM video_weights WHERE folder_name=? "
            "ORDER BY ema_reward DESC, video_path ASC LIMIT ?",
            (folder, limit),
        ).fetchall()
        return [r["video_path"] for r in rows]

    # -- reward updates --
    def apply_video_reward(self, path: str, reward: float, halflife: float, alpha: float, played: bool = False):
        """Update a video's reward EMA, and roll the same signal up into its
        parent folder so folder-level selection actually learns too."""
        now = time.time()
        conn = self._connect()
        row = conn.execute(
            "SELECT ema_reward, play_count, updated_at, folder_name FROM video_weights WHERE video_path=?",
            (path,),
        ).fetchone()
        if row is None:
            return

        video_ema = (1 - alpha) * decayed_value(row["ema_reward"], row["updated_at"], now, halflife) + alpha * reward
        conn.execute(
            "UPDATE video_weights SET ema_reward=?, play_count=?, updated_at=? WHERE video_path=?",
            (video_ema, row["play_count"] + (1 if played else 0), now, path),
        )

        folder_row = conn.execute(
            "SELECT ema_reward, updated_at FROM folder_weights WHERE folder_name=?", (row["folder_name"],)
        ).fetchone()
        if folder_row is not None:
            folder_ema = (1 - alpha) * decayed_value(
                folder_row["ema_reward"], folder_row["updated_at"], now, halflife
            ) + alpha * reward
            conn.execute(
                "UPDATE folder_weights SET ema_reward=?, updated_at=? WHERE folder_name=?",
                (folder_ema, now, row["folder_name"]),
            )
        conn.commit()
