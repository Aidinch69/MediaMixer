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
    yield create_app(AppContext(config, db, sessions)).test_client()
    sessions.stop()


def names(resp):
    return [s["name"] for s in resp.get_json()["scenes"]]


def test_save_list_overwrite(client):
    assert client.get("/api/scenes").get_json() == {"scenes": [], "zones": {z: None for z in ("chase", "color", "jackpot", "vault", "rhythm")}}
    client.post("/api/scenes", json={"name": "  Deep   Trance ", "data": {"v": 1, "screen": {"layout": "dual"}}})
    r = client.post("/api/scenes", json={"name": "Chaos", "data": {"v": 1}})
    assert names(r) == ["Chaos", "Deep Trance"]  # whitespace tidied, sorted
    r = client.post("/api/scenes", json={"name": "Deep Trance", "data": {"v": 1, "screen": {"layout": "grid3x3"}}})
    scene = next(s for s in r.get_json()["scenes"] if s["name"] == "Deep Trance")
    assert scene["data"]["screen"]["layout"] == "grid3x3" and len(names(r)) == 2


def test_rejects_bad_scenes(client):
    assert client.post("/api/scenes", json={"name": "", "data": {}}).status_code == 400
    assert client.post("/api/scenes", json={"name": "x", "data": "nope"}).status_code == 400
    assert client.post("/api/scenes", json={"name": "x", "data": {"blob": "z" * 40000}}).status_code == 400


def test_zones_follow_rename_and_delete(client):
    client.post("/api/scenes", json={"name": "Calm", "data": {"v": 1}})
    r = client.post("/api/scenes/zones", json={"zone": "vault", "value": "Calm"})
    assert r.get_json()["zones"]["vault"] == "Calm"
    assert client.post("/api/scenes/zones", json={"zone": "chase", "value": "auto"}).get_json()["zones"]["chase"] == "auto"
    assert client.post("/api/scenes/zones", json={"zone": "vault", "value": "Missing"}).status_code == 400
    assert client.post("/api/scenes/zones", json={"zone": "nowhere", "value": None}).status_code == 400

    r = client.post("/api/scenes/rename", json={"from": "Calm", "to": "Still"})
    assert names(r) == ["Still"] and r.get_json()["zones"]["vault"] == "Still"
    r = client.post("/api/scenes/delete", json={"name": "Still"})
    assert names(r) == [] and r.get_json()["zones"]["vault"] is None and r.get_json()["zones"]["chase"] == "auto"


def test_rename_refuses_existing_name(client):
    client.post("/api/scenes", json={"name": "A", "data": {}})
    client.post("/api/scenes", json={"name": "B", "data": {}})
    assert client.post("/api/scenes/rename", json={"from": "A", "to": "B"}).status_code == 409


def test_status_reports_pace_tone_and_beat(client):
    client.get("/")  # creates the viewer session
    client.get("/api/tone?index=2")
    d = client.get("/api/status").get_json()
    assert d["tone_index"] == 2 and "pace_idx" in d and "binaural_knob" in d
