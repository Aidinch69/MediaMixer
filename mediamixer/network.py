"""Network discovery, so the dashboard can tell you (and your phone) where to find it."""
from __future__ import annotations

import json
import logging
import shutil
import socket
import subprocess
from typing import Optional

log = logging.getLogger(__name__)

_TAILSCALE_CANDIDATES = ("tailscale", r"C:\Program Files\Tailscale\tailscale.exe")


def get_lan_ip() -> str:
    """Best-effort guess at this machine's LAN-facing IPv4 address.

    Opens a UDP socket "connected" to a public address purely so the OS picks
    the right outbound interface for its source address - no packet is
    actually sent. Falls back to loopback if there's no route out at all.
    """
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.connect(("8.8.8.8", 80))
        return sock.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        sock.close()


def _tailscale_binary() -> Optional[str]:
    for candidate in _TAILSCALE_CANDIDATES:
        if shutil.which(candidate):
            return candidate
    return None


def get_tailscale_https_url(port: int) -> Optional[str]:
    """If `tailscale serve` is actively proxying `port` over HTTPS, return the
    trusted https://<tailnet-hostname> URL for it - reachable by any device
    on your own tailnet (e.g. your phone with Tailscale installed), with a
    real certificate, unlike the plain-HTTP LAN address. Returns None if
    Tailscale isn't installed, not configured, or not proxying this port -
    callers should fall back to the LAN address in that case.
    """
    binary = _tailscale_binary()
    if not binary:
        return None
    try:
        result = subprocess.run(
            [binary, "serve", "status", "--json"],
            capture_output=True,
            text=True,
            timeout=2,
        )
        if result.returncode != 0 or not result.stdout.strip():
            return None
        config = json.loads(result.stdout.lstrip("\ufeff"))
        target_suffix = f":{port}"
        for host_port, entry in (config.get("Web") or {}).items():
            for handler in (entry.get("Handlers") or {}).values():
                if handler.get("Proxy", "").endswith(target_suffix):
                    return f"https://{host_port.split(':')[0]}"
    except Exception:
        log.debug("tailscale serve status check failed", exc_info=True)
    return None
