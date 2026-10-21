"""Minimal headless-Chrome driver over the DevTools Protocol.

Used by the smoke test and any one-off verification scripts. Needs
`websocket-client` (requirements-dev.txt) and a local Chrome install.

    with Browser() as b:
        b.navigate("http://127.0.0.1:5000/")
        b.pump(6)
        print(b.ev("tileElements.length"))
        assert not b.errors
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import time
import urllib.request

import websocket

CHROME_CANDIDATES = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
]


def find_chrome() -> str:
    for path in CHROME_CANDIDATES:
        if os.path.exists(path):
            return path
    raise FileNotFoundError("Chrome/Edge not found; edit CHROME_CANDIDATES in tools/cdp.py")


class Browser:
    def __init__(self, port: int = 9333, width: int = 1600, height: int = 900, timeout: float = 60, args=()):
        self.port = port
        self.args = list(args)  # extra Chrome flags, e.g. ["--disable-gpu"]
        self.size = (width, height)
        self.timeout = timeout
        self.errors: list[str] = []
        self._id = 0
        self._proc = None
        self._ws = None
        self._profile = None

    def __enter__(self) -> "Browser":
        self._profile = tempfile.mkdtemp(prefix="mm-chrome-")
        self._proc = subprocess.Popen([
            find_chrome(), "--headless=new", f"--remote-debugging-port={self.port}",
            "--remote-allow-origins=*", "--autoplay-policy=no-user-gesture-required",
            "--mute-audio", f"--window-size={self.size[0]},{self.size[1]}",
            f"--user-data-dir={self._profile}", *self.args, "about:blank",
        ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        page = None
        for _ in range(80):
            try:
                tabs = json.load(urllib.request.urlopen(f"http://127.0.0.1:{self.port}/json"))
                page = next(t for t in tabs if t["type"] == "page")
                break
            except Exception:
                time.sleep(0.25)
        if page is None:
            self.__exit__(None, None, None)
            raise RuntimeError("Chrome DevTools endpoint never came up")
        # New Chrome rejects any Origin header on the DevTools socket, even with
        # --remote-allow-origins, so send none.
        self._ws = websocket.create_connection(page["webSocketDebuggerUrl"], timeout=self.timeout, suppress_origin=True)
        self.send("Runtime.enable")
        self.send("Page.enable")
        return self

    def __exit__(self, *exc) -> None:
        if self._ws:
            self._ws.close()
        if self._proc:
            self._proc.terminate()
            try:
                self._proc.wait(5)
            except subprocess.TimeoutExpired:
                self._proc.kill()
        if self._profile:
            shutil.rmtree(self._profile, ignore_errors=True)

    def send(self, method: str, params: dict | None = None) -> dict:
        self._id += 1
        mid = self._id
        self._ws.send(json.dumps({"id": mid, "method": method, "params": params or {}}))
        while True:
            m = json.loads(self._ws.recv())
            self._collect_error(m)
            if m.get("id") == mid:
                return m.get("result", {})

    def _collect_error(self, m: dict) -> None:
        method = m.get("method")
        if method == "Runtime.exceptionThrown":
            d = m["params"]["exceptionDetails"]
            self.errors.append("EXC " + (d.get("exception", {}).get("description") or d.get("text", "")))
        elif method == "Runtime.consoleAPICalled" and m["params"]["type"] == "error":
            args = m["params"]["args"]
            self.errors.append("CONSOLE " + " ".join(str(a.get("value", a.get("description", ""))) for a in args))

    def ev(self, expr: str, wait: bool = True):
        """Evaluate a JS expression in the page and return its JSON value."""
        r = self.send("Runtime.evaluate", {"expression": expr, "awaitPromise": wait, "returnByValue": True})
        if "exceptionDetails" in r:
            desc = r["exceptionDetails"].get("exception", {}).get("description") or r["exceptionDetails"].get("text")
            raise RuntimeError(f"JS error evaluating {expr[:60]!r}: {desc}")
        return r.get("result", {}).get("value")

    def navigate(self, url: str) -> None:
        self.send("Page.navigate", {"url": url})

    def pump(self, seconds: float) -> None:
        """Wait while still draining events, so page errors are captured."""
        end = time.time() + seconds
        while time.time() < end:
            self.send("Runtime.evaluate", {"expression": "1"})
            time.sleep(0.25)

    def screenshot(self, path: str) -> None:
        import base64
        data = self.send("Page.captureScreenshot", {"format": "png"})["data"]
        with open(path, "wb") as f:
            f.write(base64.b64decode(data))
