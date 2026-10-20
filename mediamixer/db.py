"""SQLite-backed storage for folder/video/audio reward weights.

One connection per thread (SQLite connections aren't thread-safe to share),
WAL mode so the web, rotation and audio threads don't block each other.
"""
from __future__ import annotations

import json
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
CREATE TABLE IF NOT EXISTS clip_dna (
    video_path      TEXT PRIMARY KEY,
    version         INTEGER NOT NULL,
    ok              INTEGER NOT NULL,
    brightness      REAL,
    motion          REAL,
    hue             REAL,
    accent_hue      REAL,
    accent_strength REAL,
    warmth          REAL,
    saturation      REAL,
    duration        REAL,
    peak_at         REAL,
    track           TEXT,
    analyzed_at     REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS scenes (
    name        TEXT PRIMARY KEY,
    data        TEXT NOT NULL,
    updated_at  REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS app_settings (
    key    TEXT PRIMARY KEY,
    value  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    ts       REAL NOT NULL,
    session  TEXT NOT NULL,
    kind     TEXT NOT NULL,
    data     TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_session_ts ON events(session, ts);
CREATE TABLE IF NOT EXISTS audio_tracks (
    file_name   TEXT PRIMARY KEY,
    ema_reward  REAL NOT NULL DEFAULT 0.0,
    updated_at  REAL NOT NULL DEFAULT 0.0
);
"""


# The dashboard's event log (see dashboard_telemetry.js) is diagnostic, not
# history worth keeping forever - trimmed on every start.
EVENT_RETENTION_S = 14 * 86400


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
        dna_cols = {row["name"] for row in conn.execute("PRAGMA table_info(clip_dna)")}
        for column, ddl in (
            ("peak_at", "ALTER TABLE clip_dna ADD COLUMN peak_at REAL"),
            ("track", "ALTER TABLE clip_dna ADD COLUMN track TEXT"),
        ):
            if column not in dna_cols:
                conn.execute(ddl)
        conn.execute("DELETE FROM events WHERE ts < ?", (time.time() - EVENT_RETENTION_S,))
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
        ration it out one reveal at a time. `motion` comes from Clip DNA (NULL
        until a clip has been analysed)."""
        fresh_clause = "" if include_fresh else " AND NOT " + _FRESH_CONDITION.replace("added_at", "v.added_at").replace("debuted_at", "v.debuted_at")
        return self._connect().execute(
            "SELECT v.video_path, v.ema_reward, v.play_count, v.updated_at, d.motion, d.brightness, d.warmth, d.saturation FROM video_weights v "
            "LEFT JOIN clip_dna d ON d.video_path = v.video_path AND d.ok = 1 WHERE v.folder_name=?" + fresh_clause,
            (folder,),
        ).fetchall()

    def hearted_videos(self, folder: Optional[str] = None) -> list:
        """(video_path, heart_count) for every hearted, already-debuted clip,
        optionally limited to one folder - the jackpot draw pool."""
        sql = "SELECT video_path, heart_count FROM video_weights WHERE heart_count > 0 AND NOT " + _FRESH_CONDITION
        args: tuple = ()
        if folder is not None:
            sql += " AND folder_name=?"
            args = (folder,)
        return self._connect().execute(sql, args).fetchall()

    def top_videos_by_reward(self, folder: str, limit: int) -> list:
        """Top `limit` videos, hearts first (they're permanent, unlike the
        decaying ema_reward), then reward. Ties break randomly: nearly every
        clip ties on reward, and a `video_path` tie-break handed every
        jackpot to the same alphabetically-first clips. Duplicate picks
        across screens are prevented by the caller's exclude set instead."""
        rows = self._connect().execute(
            "SELECT video_path FROM video_weights WHERE folder_name=? AND NOT " + _FRESH_CONDITION +
            " ORDER BY heart_count DESC, ema_reward DESC, RANDOM() LIMIT ?",
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
            "ORDER BY heart_count DESC, ema_reward DESC, RANDOM() LIMIT ?",
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

    # -- clip DNA --
    def paths_missing_dna(self, version: int) -> list:
        rows = self._connect().execute(
            "SELECT v.video_path FROM video_weights v LEFT JOIN clip_dna d ON d.video_path = v.video_path "
            "WHERE d.video_path IS NULL OR d.version < ? ORDER BY v.play_count DESC",
            (version,),
        ).fetchall()
        return [r["video_path"] for r in rows]

    def save_dna(self, path: str, dna: Optional[dict], version: int):
        d = dna or {}
        conn = self._connect()
        conn.execute(
            "INSERT INTO clip_dna (video_path, version, ok, brightness, motion, hue, accent_hue, accent_strength, warmth, saturation, duration, peak_at, track, analyzed_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(video_path) DO UPDATE SET version=excluded.version, ok=excluded.ok, "
            "brightness=excluded.brightness, motion=excluded.motion, hue=excluded.hue, accent_hue=excluded.accent_hue, "
            "accent_strength=excluded.accent_strength, warmth=excluded.warmth, saturation=excluded.saturation, "
            "duration=excluded.duration, peak_at=excluded.peak_at, track=excluded.track, analyzed_at=excluded.analyzed_at",
            (path, version, 1 if dna else 0, d.get("brightness"), d.get("motion"), d.get("hue"), d.get("accent_hue"),
             d.get("accent_strength"), d.get("warmth"), d.get("saturation"), d.get("duration"), d.get("peak_at"),
             json.dumps(d["track"], separators=(",", ":")) if d.get("track") else None, time.time()),
        )
        conn.commit()

    def dna_rows(self, folder: Optional[str] = None) -> list:
        """Analysed, playable (debuted) clips with their DNA."""
        sql = ("SELECT d.* FROM clip_dna d JOIN video_weights v ON v.video_path = d.video_path WHERE d.ok = 1 AND NOT "
               + _FRESH_CONDITION.replace("added_at", "v.added_at").replace("debuted_at", "v.debuted_at"))
        args: tuple = ()
        if folder is not None:
            sql += " AND v.folder_name = ?"
            args = (folder,)
        return self._connect().execute(sql, args).fetchall()

    def dna_heart_rows(self) -> list:
        """Every analysed clip's traits with its all-time hearts and plays."""
        return self._connect().execute(
            "SELECT d.brightness, d.motion, d.warmth, d.saturation, v.heart_count, v.play_count FROM clip_dna d "
            "JOIN video_weights v ON v.video_path = d.video_path WHERE d.ok = 1"
        ).fetchall()

    def dna_for(self, path: str):
        return self._connect().execute("SELECT * FROM clip_dna WHERE video_path=? AND ok=1", (path,)).fetchone()

    def dna_counts(self, version: int = 0) -> dict:
        """Progress at `version`: older analyses still count as usable, just not as done."""
        conn = self._connect()
        total = conn.execute("SELECT COUNT(*) AS n FROM video_weights").fetchone()["n"]
        ok = conn.execute("SELECT COUNT(*) AS n FROM clip_dna WHERE ok=1 AND version>=?", (version,)).fetchone()["n"]
        failed = conn.execute("SELECT COUNT(*) AS n FROM clip_dna WHERE ok=0 AND version>=?", (version,)).fetchone()["n"]
        return {"total": total, "analysed": ok, "failed": failed}

    # -- scenes (saved looks, shared by every device) --
    def list_scenes(self) -> list:
        return self._connect().execute("SELECT name, data, updated_at FROM scenes ORDER BY name COLLATE NOCASE").fetchall()

    def save_scene(self, name: str, data: str):
        conn = self._connect()
        conn.execute(
            "INSERT INTO scenes (name, data, updated_at) VALUES (?, ?, ?) "
            "ON CONFLICT(name) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at",
            (name, data, time.time()),
        )
        conn.commit()

    def delete_scene(self, name: str) -> bool:
        conn = self._connect()
        cur = conn.execute("DELETE FROM scenes WHERE name=?", (name,))
        conn.commit()
        return cur.rowcount > 0

    def rename_scene(self, old: str, new: str) -> bool:
        conn = self._connect()
        if conn.execute("SELECT 1 FROM scenes WHERE name=?", (new,)).fetchone():
            return False
        cur = conn.execute("UPDATE scenes SET name=?, updated_at=? WHERE name=?", (new, time.time(), old))
        conn.commit()
        return cur.rowcount > 0

    def get_setting(self, key: str, default=None):
        row = self._connect().execute("SELECT value FROM app_settings WHERE key=?", (key,)).fetchone()
        return row["value"] if row else default

    def set_setting(self, key: str, value: str):
        conn = self._connect()
        conn.execute("INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key, value))
        conn.commit()

    # -- event log --
    def add_events(self, session: str, events: list):
        """events: (ts, kind, data_json) tuples."""
        conn = self._connect()
        conn.executemany(
            "INSERT INTO events (ts, session, kind, data) VALUES (?, ?, ?, ?)",
            [(ts, session, kind, data) for ts, kind, data in events],
        )
        conn.commit()

    def events_after(self, session: str, after_id: int = 0, since_ts: float = 0.0, limit: int = 5000) -> list:
        return self._connect().execute(
            "SELECT id, ts, kind, data FROM events WHERE session=? AND id>? AND ts>=? ORDER BY id LIMIT ?",
            (session, after_id, since_ts, limit),
        ).fetchall()

    def event_sessions(self, since_ts: float) -> list:
        return self._connect().execute(
            "SELECT session, COUNT(*) AS n, MIN(ts) AS first_ts, MAX(ts) AS last_ts FROM events "
            "WHERE ts>=? GROUP BY session ORDER BY last_ts DESC",
            (since_ts,),
        ).fetchall()

    def mark_played(self, path: str):
        """Count a play without touching the reward EMA - showing a clip is
        not a judgement of it, and feeding it a 0.0 reward wiped out likes."""
        conn = self._connect()
        conn.execute("UPDATE video_weights SET play_count = play_count + 1 WHERE video_path=?", (path,))
        conn.commit()

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
        # Where this clip sits among all hearted clips (0 = most hearted, 1 =
        # least), so "a real favourite" can be judged relative to the library
        # instead of by a fixed count that hearting keeps outgrowing.
        heart_top_frac = None
        if row["heart_count"] > 0:
            conn = self._connect()
            above = conn.execute("SELECT COUNT(*) AS n FROM video_weights WHERE heart_count > ?", (row["heart_count"],)).fetchone()["n"]
            hearted = conn.execute("SELECT COUNT(*) AS n FROM video_weights WHERE heart_count > 0").fetchone()["n"]
            heart_top_frac = above / max(1, hearted)
        return {"heart_count": row["heart_count"], "loop_anchor": loop_anchor, "heart_top_frac": heart_top_frac}

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
