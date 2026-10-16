"""SQLite-backed storage for folder/video/audio reward weights.

One connection per thread (SQLite connections aren't thread-safe to share),
WAL mode so the web, rotation and audio threads don't block each other.
"""
from __future__ import annotations

import logging
import sqlite3
import threading
import time
from typing import Optional

from .bandit import decayed_value
from .config import Config

log = logging.getLogger(__name__)

# A clip that arrived after the initial library scan and hasn't had its
# Fresh Drop reveal yet.
_FRESH_CONDITION = "(added_at > 0 AND debuted_at IS NULL)"

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
    updated_at  REAL NOT NULL DEFAULT 0.0,
    heart_count    INTEGER NOT NULL DEFAULT 0,
    first_heart_at REAL,
    last_heart_at  REAL,
    loop_anchor_min REAL,
    loop_anchor_max REAL,
    added_at    REAL NOT NULL DEFAULT 0,
    debuted_at  REAL
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
            self._migrate(conn)

    def _migrate(self, conn: sqlite3.Connection):
        """CREATE TABLE IF NOT EXISTS only helps brand-new databases - an
        existing system_memory.db (which every current install already has,
        full of real reward history) keeps whatever columns it was created
        with. Add any columns a prior version's schema is missing, each
        guarded so re-running this on an already-migrated db is a no-op."""
        existing = {row["name"] for row in conn.execute("PRAGMA table_info(video_weights)")}
        for column, ddl in (
            ("heart_count", "ALTER TABLE video_weights ADD COLUMN heart_count INTEGER NOT NULL DEFAULT 0"),
            ("first_heart_at", "ALTER TABLE video_weights ADD COLUMN first_heart_at REAL"),
            ("last_heart_at", "ALTER TABLE video_weights ADD COLUMN last_heart_at REAL"),
            ("loop_anchor_min", "ALTER TABLE video_weights ADD COLUMN loop_anchor_min REAL"),
            ("loop_anchor_max", "ALTER TABLE video_weights ADD COLUMN loop_anchor_max REAL"),
            # Fresh Drop: DEFAULT 0 marks every row that already existed
            # before this column did as "old library" rather than "fresh" -
            # only clips that show up in a later sync get a real timestamp.
            ("added_at", "ALTER TABLE video_weights ADD COLUMN added_at REAL NOT NULL DEFAULT 0"),
            ("debuted_at", "ALTER TABLE video_weights ADD COLUMN debuted_at REAL"),
        ):
            if column not in existing:
                conn.execute(ddl)
        conn.commit()

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

    def ensure_video(self, path: str, folder: str, fresh: bool = False):
        """`fresh` stamps added_at so Fresh Drop holds the clip back from
        ordinary rotation until it gets its own debut - see video_rewards."""
        self._connect().execute(
            "INSERT OR IGNORE INTO video_weights(video_path, folder_name, added_at) VALUES (?, ?, ?)",
            (path, folder, time.time() if fresh else 0),
        )

    def video_count(self) -> int:
        return self._connect().execute("SELECT COUNT(*) AS n FROM video_weights").fetchone()["n"]

    # -- selection --
    def folder_rewards(self):
        return self._connect().execute("SELECT folder_name, ema_reward, updated_at FROM folder_weights").fetchall()

    def video_rewards(self, folder: str, include_fresh: bool = False):
        """Fresh (not-yet-debuted) clips are left out by default so ordinary
        rotation can't burn through a new batch before Fresh Drop gets to
        ration it out one reveal at a time."""
        fresh_clause = "" if include_fresh else " AND NOT " + _FRESH_CONDITION
        return self._connect().execute(
            "SELECT video_path, ema_reward, play_count, updated_at FROM video_weights WHERE folder_name=?" + fresh_clause,
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
            "SELECT video_path FROM video_weights WHERE folder_name=? AND NOT " + _FRESH_CONDITION +
            " ORDER BY ema_reward DESC, video_path ASC LIMIT ?",
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

    # -- self-building favorites --
    def has_favorites(self) -> bool:
        return self._connect().execute("SELECT 1 FROM video_weights WHERE heart_count > 0 LIMIT 1").fetchone() is not None

    def favorite_video_rewards(self) -> list:
        """Every hearted video across every folder, shaped like video_rewards()
        so pick_video's scoring can treat it as just another folder."""
        return self._connect().execute(
            "SELECT video_path, ema_reward, play_count, updated_at FROM video_weights WHERE heart_count > 0"
        ).fetchall()

    def random_favorite_pair(self, exclude: set) -> Optional[list]:
        """Two distinct favorited videos for Double Feature - paired by
        shared Favorites membership rather than needing real folders to
        point them at each other. Headroom past 2 (same pattern as
        top_videos_by_reward) so there's enough to skip past anything
        already showing elsewhere and still land on a real pair."""
        rows = self._connect().execute(
            "SELECT video_path FROM video_weights WHERE heart_count > 0 ORDER BY RANDOM() LIMIT ?",
            (2 + len(exclude),),
        ).fetchall()
        candidates = [r["video_path"] for r in rows if r["video_path"] not in exclude]
        return candidates[:2] if len(candidates) >= 2 else None

    def favorite_top_videos(self, limit: int) -> list:
        rows = self._connect().execute(
            "SELECT video_path FROM video_weights WHERE heart_count > 0 "
            "ORDER BY ema_reward DESC, video_path ASC LIMIT ?",
            (limit,),
        ).fetchall()
        return [r["video_path"] for r in rows]

    # -- true mystery tile --
    def random_unplayed_video(self, folder: Optional[str] = None) -> Optional[str]:
        """A clip with play_count=0 - genuinely never selected by rotation
        yet, not just rarely played. True Mystery Tile's whole point is
        "you've never seen this before," which only this (not low
        ema_reward or low play_count generally) can actually promise."""
        conn = self._connect()
        if folder:
            row = conn.execute(
                "SELECT video_path FROM video_weights WHERE folder_name=? AND play_count=0 "
                "AND NOT " + _FRESH_CONDITION + " ORDER BY RANDOM() LIMIT 1",
                (folder,),
            ).fetchone()
        else:
            row = conn.execute(
                "SELECT video_path FROM video_weights WHERE play_count=0 AND NOT " + _FRESH_CONDITION +
                " ORDER BY RANDOM() LIMIT 1"
            ).fetchone()
        return row["video_path"] if row else None

    # -- fresh drop --
    def fresh_video_paths(self) -> list:
        rows = self._connect().execute(
            "SELECT video_path FROM video_weights WHERE " + _FRESH_CONDITION + " ORDER BY added_at ASC"
        ).fetchall()
        return [r["video_path"] for r in rows]

    def mark_debuted(self, path: str):
        conn = self._connect()
        conn.execute("UPDATE video_weights SET debuted_at=? WHERE video_path=?", (time.time(), path))
        conn.commit()

    # -- custom loop point --
    def get_loop_anchor(self, path: str) -> Optional[dict]:
        row = self._connect().execute(
            "SELECT loop_anchor_min, loop_anchor_max FROM video_weights WHERE video_path=?", (path,)
        ).fetchone()
        if row is None or row["loop_anchor_min"] is None or row["loop_anchor_max"] is None:
            return None
        return {"min": row["loop_anchor_min"], "max": row["loop_anchor_max"]}

    def get_video_meta(self, path: str) -> dict:
        """One-row lookup for everything a tile's own client-side lookup
        needs about its *current* clip specifically - loop anchor (Custom
        Loop Point) and heart_count (Featured Tile's "is this actually a
        favorite" check) - so a tile only has to make one request per clip
        load instead of one per feature that wants to know something about
        it."""
        row = self._connect().execute(
            "SELECT heart_count, loop_anchor_min, loop_anchor_max FROM video_weights WHERE video_path=?", (path,)
        ).fetchone()
        if row is None:
            return {"heart_count": 0, "loop_anchor": None}
        loop_anchor = None
        if row["loop_anchor_min"] is not None and row["loop_anchor_max"] is not None:
            loop_anchor = {"min": row["loop_anchor_min"], "max": row["loop_anchor_max"]}
        return {"heart_count": row["heart_count"], "loop_anchor": loop_anchor}

    def bump_loop_anchor(self, path: str, position: float) -> Optional[dict]:
        """Widen (never narrow) this video's hearted-position range to
        include `position` - the raw playback-position counterpart to
        bump_heart's wall-clock timestamps. loop_anchor_min only ever
        decreases and loop_anchor_max only ever increases, so the window
        Custom Loop Point reads from this can only grow toward covering
        more of what's been hearted, never shrink away from a moment
        once it's been included."""
        conn = self._connect()
        row = conn.execute(
            "SELECT loop_anchor_min, loop_anchor_max FROM video_weights WHERE video_path=?", (path,)
        ).fetchone()
        if row is None:
            return None
        new_min = position if row["loop_anchor_min"] is None else min(row["loop_anchor_min"], position)
        new_max = position if row["loop_anchor_max"] is None else max(row["loop_anchor_max"], position)
        conn.execute(
            "UPDATE video_weights SET loop_anchor_min=?, loop_anchor_max=? WHERE video_path=?",
            (new_min, new_max, path),
        )
        conn.commit()
        return {"min": new_min, "max": new_max}

    def bump_heart(self, path: str, amount: int = 1) -> Optional[dict]:
        """Record a heart (upvote) on a video: bump its count and track the
        earliest/latest heart timestamps, which Custom Loop Point and the
        Heart Streak Badge both key off of. `amount` > 1 is Hold-to-Heart's
        amplified press - still one heart *event* (one first/last_heart_at
        stamp), just worth more toward heart_count."""
        now = time.time()
        conn = self._connect()
        row = conn.execute(
            "SELECT heart_count, first_heart_at FROM video_weights WHERE video_path=?",
            (path,),
        ).fetchone()
        if row is None:
            return None

        new_count = row["heart_count"] + amount
        first_heart_at = row["first_heart_at"] if row["first_heart_at"] is not None else now
        conn.execute(
            "UPDATE video_weights SET heart_count=?, first_heart_at=?, last_heart_at=? WHERE video_path=?",
            (new_count, first_heart_at, now, path),
        )
        conn.commit()
        return {"heart_count": new_count, "first_heart_at": first_heart_at, "last_heart_at": now}
