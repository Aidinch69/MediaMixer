import time

import pytest

from conftest import make_clips
from mediamixer import library
from mediamixer.context import AppContext
from mediamixer.session import SessionManager
from mediamixer.web.app import create_app


@pytest.fixture
def client(config, db):
    make_clips(config, ["a.mp4", "b.mp4"])
    library.sync_library(db, config)
    sessions = SessionManager(db, config)
    app = create_app(AppContext(config, db, sessions))
    yield app.test_client()
    sessions.stop()


def post(client, events):
    return client.post("/api/events", json={"events": events})


def test_events_round_trip(client):
    now_ms = time.time() * 1000
    r = post(client, [{"t": now_ms, "k": "chase.catch", "d": {"chain": 3}}, {"t": now_ms + 1, "k": "xp", "d": {"amount": 5}}])
    assert r.get_json()["stored"] == 2
    got = client.get("/api/events").get_json()
    assert [e["k"] for e in got["events"]] == ["chase.catch", "xp"]
    assert got["events"][0]["d"] == {"chain": 3}

    after = got["events"][-1]["id"]
    post(client, [{"t": now_ms + 2, "k": "rate"}])
    newer = client.get(f"/api/events?session={got['session']}&after={after}").get_json()
    assert [e["k"] for e in newer["events"]] == ["rate"]


def test_bad_events_are_dropped_or_clamped(client):
    r = post(client, [{"k": ""}, {"t": "junk", "k": "x"}, {"t": 1, "k": "y"}, {"k": "big", "d": {"s": "z" * 10000}}])
    assert r.get_json()["stored"] == 3
    events = client.get("/api/events").get_json()["events"]
    assert all(abs(e["t"] - time.time()) < 60 for e in events)  # junk/ancient clocks fall back to arrival time
    assert next(e for e in events if e["k"] == "big")["d"] == {"truncated": True}


def test_debug_reads_do_not_create_sessions(client):
    client.get("/debug")
    client.get("/api/events")
    client.get("/api/events/sessions")
    assert client.get_cookie("mm_session") is None


def test_sessions_listing(client):
    post(client, [{"t": time.time() * 1000, "k": "spin"}])
    sessions = client.get("/api/events/sessions").get_json()["sessions"]
    assert len(sessions) == 1 and sessions[0]["n"] == 1


def test_rotate_on_a_pinned_or_held_tile_says_held_and_keeps_its_clip(client):
    status = client.get("/api/status").get_json()
    before = status["screens"][0]["path"]
    client.get("/api/pin?screen=0&on=1")
    r = client.get("/api/rotate?screen=0").get_json()
    assert r["held"] is True
    assert client.get("/api/status").get_json()["screens"][0]["path"] == before
    client.get("/api/pin?screen=0&on=0")
    assert "held" not in client.get("/api/rotate?screen=0").get_json()
