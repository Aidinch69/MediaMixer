"""Where the media comes from: one or more folders per kind of source.

Each kind (tile clips, spirals, floater overlays, overlay audio) is a list of
root folders picked in the menu, stored in the `sources` app setting. With
nothing picked, a kind falls back to its folder from config.py (media_assets/,
Spirals/, overlay_fx/, Audios/ in the project root).

Every root is scanned recursively, so a root can be a parent folder of a
whole library. For tile clips, a root's top-level subfolders are the
categories the reward system learns over (anything deeper counts toward its
top-level folder) and files sitting directly in a root are "General".

The browser addresses a file as "<root id>/<path inside the root>"; the id
is a short hash of the root's absolute path, so it stays the same between
runs and two roots with the same file names never collide - in URLs or in
the proxy cache, which keeps each root's proxies under proxy_dir/<root id>/.
"""
from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import string
import threading
from typing import Dict, Iterator, List, NamedTuple, Optional, Tuple

SETTING_KEY = "sources"
KINDS = ("tiles", "spirals", "overlay", "audio")
KIND_LABELS = {
    "tiles": "Tile Source",
    "spirals": "Spiral Source",
    "overlay": "Overlay Source",
    "audio": "Audio Source",
}
_DEFAULT_ATTR = {"tiles": "media_dir", "spirals": "spirals_dir", "overlay": "overlay_fx_dir", "audio": "audio_dir"}


class Root(NamedTuple):
    id: str
    path: str


def root_id(path: str) -> str:
    return hashlib.sha1(os.path.normcase(os.path.abspath(path)).encode("utf-8")).hexdigest()[:8]


def _skip_dir(name: str) -> bool:
    return name.startswith(("_", ".")) or name in ("$RECYCLE.BIN", "System Volume Information")


class Sources:
    def __init__(self, config):
        self._config = config
        self._lock = threading.Lock()
        self._roots: Optional[Dict[str, List[Root]]] = None

    # -- settings --
    def _read_setting(self) -> dict:
        try:
            conn = sqlite3.connect(self._config.db_path, timeout=5.0)
            try:
                row = conn.execute("SELECT value FROM app_settings WHERE key=?", (SETTING_KEY,)).fetchone()
            finally:
                conn.close()
            return json.loads(row[0]) if row and row[0] else {}
        except (sqlite3.Error, ValueError):
            return {}

    def chosen(self) -> dict:
        """The folders picked in the menu, per kind (empty = using the default)."""
        data = self._read_setting()
        return {kind: [p for p in data.get(kind, []) if isinstance(p, str)] for kind in KINDS}

    def set_chosen(self, kind: str, paths: List[str]) -> List[str]:
        if kind not in KINDS:
            raise ValueError(f"unknown source kind {kind!r}")
        clean: List[str] = []
        for p in paths:
            full = os.path.abspath(os.path.expanduser(str(p).strip()))
            if not os.path.isdir(full):
                raise ValueError(f"not a folder: {p}")
            if os.path.normcase(full) not in {os.path.normcase(c) for c in clean}:
                clean.append(full)
        data = self.chosen()
        data[kind] = clean
        conn = sqlite3.connect(self._config.db_path, timeout=5.0)
        try:
            conn.execute("CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
            conn.execute(
                "INSERT INTO app_settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (SETTING_KEY, json.dumps(data)),
            )
            conn.commit()
        finally:
            conn.close()
        self.reload()
        return clean

    def reload(self):
        with self._lock:
            self._roots = None

    # -- roots --
    def default_dir(self, kind: str) -> str:
        return os.path.abspath(getattr(self._config, _DEFAULT_ATTR[kind]))

    def roots(self, kind: str) -> List[Root]:
        with self._lock:
            if self._roots is None:
                chosen = self.chosen()
                self._roots = {
                    k: [Root(root_id(p), p) for p in (chosen[k] or [self.default_dir(k)])] for k in KINDS
                }
            return list(self._roots[kind])

    def ensure_default_dirs(self):
        """Create the project-root default folders a fresh checkout doesn't
        have yet - only for kinds still using their default."""
        chosen = self.chosen()
        for kind in KINDS:
            if not chosen[kind]:
                os.makedirs(self.default_dir(kind), exist_ok=True)

    def _excluded_dirs(self, kind: str) -> set:
        # Never index the proxy cache, or another kind's root nested inside
        # this one (e.g. Spirals picked as a subfolder of the tile library).
        out = {os.path.normcase(os.path.abspath(self._config.proxy_dir))}
        for other in KINDS:
            if other != kind:
                out.update(os.path.normcase(r.path) for r in self.roots(other))
        out.difference_update(os.path.normcase(r.path) for r in self.roots(kind))
        return out

    def iter_files(self, kind: str, exts: Tuple[str, ...]) -> Iterator[Tuple[Root, str]]:
        """(root, absolute path) for every matching file under every root of
        `kind`, recursively, in a stable order."""
        excluded = self._excluded_dirs(kind)
        seen = set()
        for root in self.roots(kind):
            if not os.path.isdir(root.path):
                continue  # e.g. an unplugged external drive - its clips just sit out
            for dirpath, dirnames, filenames in os.walk(root.path):
                dirnames[:] = sorted(
                    d for d in dirnames
                    if not _skip_dir(d) and os.path.normcase(os.path.join(dirpath, d)) not in excluded
                )
                for name in sorted(filenames):
                    if name.lower().endswith(exts):
                        full = os.path.join(dirpath, name)
                        key = os.path.normcase(full)
                        if key not in seen:  # overlapping roots (a folder and its parent both picked)
                            seen.add(key)
                            yield root, full

    def find_root(self, path: str, kind: Optional[str] = None) -> Optional[Root]:
        """The (deepest) root that contains `path`."""
        norm = os.path.normcase(os.path.abspath(path))
        best = None
        for k in ([kind] if kind else KINDS):
            for root in self.roots(k):
                base = os.path.normcase(root.path)
                if norm.startswith(base.rstrip(os.sep) + os.sep) and (best is None or len(root.path) > len(best.path)):
                    best = root
        return best

    # -- addressing --
    def to_rel(self, path: Optional[str], kind: Optional[str] = None) -> str:
        """Absolute path -> the "<root id>/<sub/path>" form the browser uses."""
        if not path:
            return ""
        root = self.find_root(path, kind)
        if root is None:
            return ""
        return root.id + "/" + os.path.relpath(path, root.path).replace("\\", "/")

    def to_abs(self, kind: str, rel: str) -> str:
        """Inverse of to_rel. Rebuilds exactly the string the scan produced
        (video_path is a literal TEXT key), joining segment by segment so the
        OS separator is used throughout. "" for anything outside the roots."""
        if not rel or "/" not in rel:
            return ""
        rid, sub = rel.split("/", 1)
        parts = sub.split("/")
        if any(p in ("", ".", "..") for p in parts):
            return ""
        for root in self.roots(kind):
            if root.id == rid:
                return os.path.join(root.path, *parts)
        return ""

    def category(self, root: Root, path: str, general: str) -> str:
        """Tile category: the top-level folder under the root, else General."""
        rel = os.path.relpath(path, root.path)
        parts = rel.split(os.sep)
        return parts[0] if len(parts) > 1 else general

    def proxy_path(self, path: str, kind: Optional[str] = None) -> Optional[str]:
        root = self.find_root(path, kind)
        if root is None:
            return None
        rel = os.path.relpath(path, root.path)
        return os.path.join(self._config.proxy_dir, root.id, os.path.splitext(rel)[0] + ".proxy.mp4")

    def describe(self) -> dict:
        chosen = self.chosen()
        out = {}
        for kind in KINDS:
            out[kind] = {
                "label": KIND_LABELS[kind],
                "default": self.default_dir(kind),
                "using_default": not chosen[kind],
                "folders": [{"path": r.path, "exists": os.path.isdir(r.path)} for r in self.roots(kind)],
            }
        return out


_registry: Dict[str, Sources] = {}
_registry_lock = threading.Lock()


def get(config) -> Sources:
    """One Sources per database (tests each get their own)."""
    key = os.path.abspath(config.db_path)
    with _registry_lock:
        src = _registry.get(key)
        if src is None:
            src = _registry[key] = Sources(config)
        return src


def browse(path: Optional[str]) -> dict:
    """Folder listing for the in-menu folder picker (folder names only)."""
    if not path:
        if os.name == "nt":
            drives = [f"{d}:\\" for d in string.ascii_uppercase if os.path.isdir(f"{d}:\\")]
            return {"path": "", "parent": None, "folders": [{"name": d, "path": d} for d in drives]}
        path = "/"
    full = os.path.abspath(os.path.expanduser(path))
    if not os.path.isdir(full):
        raise ValueError("not a folder")
    folders = []
    try:
        with os.scandir(full) as it:
            for entry in it:
                try:
                    if entry.is_dir() and not entry.name.startswith(("$", ".")):
                        folders.append({"name": entry.name, "path": entry.path})
                except OSError:
                    continue
    except PermissionError:
        pass
    folders.sort(key=lambda f: f["name"].lower())
    parent = os.path.dirname(full)
    if parent == full:  # at a drive / filesystem root
        parent = "" if os.name == "nt" else None  # "" = back to the drive list
    return {"path": full, "parent": parent, "folders": folders}
