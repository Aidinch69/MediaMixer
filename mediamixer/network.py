"""LAN IP discovery, so the dashboard can tell you (and your phone) where to find it."""
from __future__ import annotations

import socket


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
