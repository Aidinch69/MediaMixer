"""Native desktop viewer for the PC - a thin client that talks to the
existing Flask backend over loopback HTTP exactly like a browser tab or
phone would. No server-side changes; the backend already treats every
viewer as an independent session (see mediamixer.session).
"""
