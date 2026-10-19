"""Flask app: dashboard UI, media streaming, and the control/telemetry API.

Every viewer (a browser tab, on this PC or any other device on the network)
gets its own independent Session - see `mediamixer.session` - resolved here
from a cookie via `before_request`/`after_request` hooks, so route handlers
just use `g.session` and never have to think about who else is watching.
"""
from __future__ import annotations

import io
import json
import logging
import os
import random
import time

import qrcode
import qrcode.image.svg
from flask import Flask, Response, g, jsonify, render_template, request, send_from_directory

from .. import library, proxy
from ..context import AppContext
from ..live_config import SESSION_MIRRORED, LiveConfig
from ..network import get_lan_ip, get_tailscale_https_url
from ..session import Session

log = logging.getLogger(__name__)

_HERE = os.path.dirname(__file__)
STREAM_INTERVAL_S = 0.3
EVENT_BATCH_MAX = 500
EVENT_DATA_MAX = 2000
_NO_SESSION_PREFIXES = ("/media/", "/audio/", "/overlay_fx/", "/spirals/", "/assets/", "/sw.js")


def _relative_media_path(config, path: str) -> str:
    if not path:
        return ""
    return os.path.relpath(path, config.media_dir).replace("\\", "/")


def _absolute_media_path(config, relative_path: str) -> str:
    """Inverse of _relative_media_path - rebuilds the same absolute string
    sync_library originally stored as video_path (a literal TEXT primary
    key, so this has to reconstruct it exactly, not just resolve to the
    same file on disk). Joins segment-by-segment rather than passing the
    slash-joined relative path straight to os.path.join, so a subfolder
    video's rebuilt path uses the OS's own separator throughout instead of
    a forward slash in the middle that wouldn't string-match what's
    actually stored."""
    if not relative_path:
        return ""
    return os.path.join(config.media_dir, *relative_path.split("/"))


def _relative_audio_path(config, path) -> str:
    if not path:
        return ""
    return os.path.relpath(path, config.audio_dir).replace("\\", "/")


def _layout_columns(config, name: str) -> int:
    for preset in config.layout_presets:
        if preset.name == name:
            return preset.columns
    return 1


def _qr_svg(data: str) -> str:
    """Inline-embeddable SVG markup for a QR code (no XML prolog, no Pillow needed)."""
    img = qrcode.make(data, image_factory=qrcode.image.svg.SvgPathImage, box_size=8, border=2)
    buf = io.BytesIO()
    img.save(buf)
    svg = buf.getvalue().decode("utf-8")
    return svg.split("?>", 1)[-1].strip()


def _scan_overlay_fx_dir(config) -> list:
    """Flat listing of the dedicated overlay-fx folder: video and image files,
    each tagged with its kind so the client knows how to render it."""
    os.makedirs(config.overlay_fx_dir, exist_ok=True)
    items = []
    for name in sorted(os.listdir(config.overlay_fx_dir)):
        full = os.path.join(config.overlay_fx_dir, name)
        if not os.path.isfile(full):
            continue
        lower = name.lower()
        if lower.endswith(config.video_exts):
            items.append({"path": name, "kind": "video"})
        elif lower.endswith(config.overlay_fx_image_exts):
            items.append({"path": name, "kind": "image"})
    return items


def _scan_spirals_dir(config) -> list:
    """Flat listing of the Spirals folder: video files only, for the
    full-screen spiral overlay layer."""
    os.makedirs(config.spirals_dir, exist_ok=True)
    items = []
    for name in sorted(os.listdir(config.spirals_dir)):
        full = os.path.join(config.spirals_dir, name)
        if os.path.isfile(full) and name.lower().endswith(config.video_exts):
            items.append(name)
    return items


def create_app(ctx: AppContext) -> Flask:
    app = Flask(
        __name__,
        template_folder=os.path.join(_HERE, "templates"),
        static_folder=os.path.join(_HERE, "static"),
        static_url_path="/assets",
    )
    logging.getLogger("werkzeug").setLevel(logging.ERROR)

    config, db, sessions = ctx.config, ctx.db, ctx.sessions
    live = LiveConfig(config)

    @app.before_request
    def _load_session():
        if request.path.startswith(_NO_SESSION_PREFIXES):
            return
        # The debug view (often opened on a second device) only reads the
        # event log - it shouldn't spin up a viewer session of its own.
        if request.method == "GET" and (request.path == "/debug" or request.path.startswith("/api/events")):
            return
        session_id = request.cookies.get(config.session_cookie_name)
        session = sessions.get(session_id)
        if session is None:
            session = sessions.create()
            g.new_session_id = session.id
        g.session = session

    @app.after_request
    def _media_cors(response):
        # Tiles load media from 127.0.0.x loopback shards (see mediaOrigin in
        # dashboard.js), which are cross-origin to the page - without this,
        # routing a tile's audio through Web Audio for the audio-reactive
        # analyser would output silence.
        if request.path.startswith("/media/"):
            response.headers["Access-Control-Allow-Origin"] = "*"
        return response

    @app.after_request
    def _persist_session_cookie(response):
        new_id = getattr(g, "new_session_id", None)
        if new_id:
            response.set_cookie(
                config.session_cookie_name,
                new_id,
                max_age=int(60 * 60 * 24 * 365),
                samesite="Lax",
                httponly=True,
            )
        return response

    def build_status(session: Session) -> dict:
        snap = session.state.snapshot()
        pace_idx = snap["pace_idx"]
        screens = [
            {
                "path": _relative_media_path(config, s["path"]),
                "name": os.path.basename(s["path"]) if s["path"] else "",
                "next_path": _relative_media_path(config, s["next_path"]),
                "tension": s["tension"],
                "speed": s["speed"],
            }
            for s in snap["screens"]
        ]
        carrier_hz, beat_hz, iso = session.state.synth_params()
        return {
            "layout": snap["layout"],
            "columns": _layout_columns(config, snap["layout"]),
            "folder": snap["folder"] or "none",
            "screens": screens,
            "audio_name": session.overlay.current_name(),
            "audio_path": _relative_audio_path(config, session.overlay.current_path()),
            "audio_available": bool(session.overlay.tracks),
            "synth": {"carrier_hz": carrier_hz, "beat_hz": beat_hz, "iso": iso},
            "lock_label": (
                "Continuous Mode"
                if pace_idx == 3
                else f"Cycle: {snap['played']}/{config.folder_rotation_limit} clips"
            ),
            "locked": snap["locked"],
            "jackpot": snap["jackpot"],
            "barrage": snap["barrage"],
            "barrage_tiles": snap["barrage_tiles"],
            "barrage_tier": snap["barrage_tier"],
            "preload_enabled": snap["preload_enabled"],
        }

    @app.route("/")
    def dashboard():
        library.sync_library(db, config)
        snap = g.session.state.snapshot()
        pace_idx = snap["pace_idx"]
        phone_url = get_tailscale_https_url(config.port) or f"http://{get_lan_ip()}:{config.port}"
        return render_template(
            "dashboard.html",
            folders=library.list_folders_with_favorites(db, config),
            tone_hz=config.tone_modes[snap["tone_index"]],
            beat_knob=f"{snap['binaural_knob']:.2f}",
            pace_idx=pace_idx,
            pace_label=config.pace_presets[pace_idx].label,
            layout_presets=config.layout_presets,
            layout_presets_json=[{"name": p.name, "tile_count": p.tile_count} for p in config.layout_presets],
            layout=snap["layout"],
            preload_enabled=snap["preload_enabled"],
            phone_url=phone_url,
            phone_qr_svg=_qr_svg(phone_url),
        )

    @app.route("/media/<path:filename>")
    def media(filename):
        # These files don't change once added, so let the browser skip even the
        # revalidation round-trip on repeat requests (e.g. a preloaded clip's
        # <video> swapping to the same URL the hidden preload element already
        # fetched in the background).
        #
        # Always prefer the cached low-res proxy when one exists, regardless
        # of tile count - this used to be gated to dense grids only
        # (tiles > proxy_tile_threshold), back when proxies were generated
        # lazily and sparsely. mediamixer/cache_warmer.py now keeps the
        # whole library covered in the background, so there's no reason to
        # withhold the win from small layouts: the full originals run
        # several Mbps each (one measured sample was 8.2 Mbps vs the
        # proxy's 1200kbps target, an ~85% reduction), a real cost even at
        # just 2 simultaneous screens, not only at 25 or 64.
        proxy_path = proxy.ensure_proxy(os.path.join(config.media_dir, filename), config)
        if proxy_path:
            directory, name = os.path.split(proxy_path)
            return send_from_directory(directory, name, max_age=86400)
        return send_from_directory(config.media_dir, filename, max_age=86400)

    @app.route("/audio/<path:filename>")
    def audio_file(filename):
        return send_from_directory(config.audio_dir, filename, max_age=86400)

    @app.route("/overlay_fx/<path:filename>")
    def overlay_fx_file(filename):
        return send_from_directory(config.overlay_fx_dir, filename, max_age=86400)

    @app.route("/spirals/<path:filename>")
    def spirals_file(filename):
        # Same cached-proxy machinery as /media/ - a full-screen overlay
        # played at 1080p+ full bitrate is just as wasteful as a tile
        # would be, even blended at low opacity.
        proxy_path = proxy.ensure_proxy(
            os.path.join(config.spirals_dir, filename), config,
            base_dir=config.spirals_dir, proxy_subdir="_spirals",
        )
        if proxy_path:
            directory, name = os.path.split(proxy_path)
            return send_from_directory(directory, name, max_age=86400)
        return send_from_directory(config.spirals_dir, filename, max_age=86400)

    @app.route("/api/folders")
    def api_folders():
        # dashboard.html gets category names baked into the server-rendered
        # template; a non-browser viewer (the native app) needs them as
        # JSON instead - read-only, additive, doesn't touch any existing route.
        return jsonify(folders=library.list_folders_with_favorites(db, config))

    @app.route("/api/overlay_fx/list")
    def api_overlay_fx_list():
        source = request.args.get("source", "dedicated")
        if source == "library":
            # Fresh clips stay out of the floaters too, or they'd leak out
            # before their own Fresh Drop reveal.
            fresh = {_relative_media_path(config, p) for p in library.fresh_video_paths(db)}
            items = [
                {"path": p, "kind": "video", "base": "/media/"}
                for p in library.list_all_videos(config) if p not in fresh
            ]
        else:
            items = [
                {"path": it["path"], "kind": it["kind"], "base": "/overlay_fx/"}
                for it in _scan_overlay_fx_dir(config)
            ]
        return jsonify(items=items)

    @app.route("/api/spirals/list")
    def api_spirals_list():
        return jsonify(items=[{"path": name, "base": "/spirals/"} for name in _scan_spirals_dir(config)])

    @app.route("/sw.js")
    def service_worker():
        # Served at the root path (not /assets/sw.js) so its default scope
        # covers the whole site, which PWA installability requires.
        resp = send_from_directory(os.path.join(_HERE, "static"), "sw.js")
        resp.headers["Service-Worker-Allowed"] = "/"
        return resp

    @app.route("/api/status")
    def api_status():
        session = g.session
        if not any(session.state.current_paths()):
            return jsonify(folder="none", screens=[])
        return jsonify(**build_status(session))

    @app.route("/api/stream")
    def api_stream():
        session = g.session  # captured now; the generator below outlives this request context

        def generate():
            last = None
            while True:
                session.touch()
                payload = json.dumps(build_status(session))
                if payload != last:
                    yield f"data: {payload}\n\n"
                    last = payload
                else:
                    yield ": keep-alive\n\n"
                time.sleep(STREAM_INTERVAL_S)

        return Response(generate(), mimetype="text/event-stream")

    @app.route("/api/skip")
    def api_skip():
        g.session.state.request_skip()
        return jsonify(ok=True)

    @app.route("/api/lock")
    def api_lock():
        g.session.state.request_lock()
        return jsonify(ok=True)

    @app.route("/api/next_audio")
    def api_next_audio():
        g.session.overlay.next_track()
        return jsonify(ok=True)

    @app.route("/api/preload")
    def api_preload():
        enabled = request.args.get("enabled", "").lower() == "true"
        g.session.state.set_preload_enabled(enabled)
        return jsonify(ok=True)

    @app.route("/api/rotate")
    def api_rotate():
        """Called by the browser when a tile's clip finishes naturally, so a clip
        shorter than its rotation window advances immediately instead of freezing
        on its last frame until the timer catches up."""
        session = g.session
        try:
            index = int(request.args.get("screen", ""))
        except (TypeError, ValueError):
            return jsonify(ok=False, error="invalid screen index"), 400
        if not (0 <= index < len(session.state.current_paths())):
            return jsonify(ok=False, error="screen index out of range"), 400
        session.rotation.rotate(side=index)
        return jsonify(ok=True)

    @app.route("/api/folder")
    def api_folder():
        folder = request.args.get("folder", "")
        if folder not in library.list_folders_with_favorites(db, config):
            return jsonify(ok=False, error="unknown folder"), 400
        g.session.rotation.rotate(override_folder=folder, side="all")
        return jsonify(ok=True)

    @app.route("/api/layout")
    def api_layout():
        session = g.session
        name = request.args.get("mode", "")
        if name not in {preset.name for preset in config.layout_presets}:
            return jsonify(ok=False, error="unknown layout"), 400
        preset = session.rotation.set_layout_and_rotate(name)
        return jsonify(ok=True, tile_count=preset.tile_count, columns=preset.columns)

    @app.route("/api/intensity")
    def api_intensity():
        if request.args.get("reset"):
            g.session.state.set_intensity(config.barrage_probability, config.jackpot_probability)
            return jsonify(ok=True)
        try:
            barrage_p = float(request.args.get("barrage", ""))
            jackpot_p = float(request.args.get("jackpot", ""))
        except (TypeError, ValueError):
            return jsonify(ok=False, error="invalid value"), 400
        g.session.state.set_intensity(barrage_p, jackpot_p)
        return jsonify(ok=True)

    @app.route("/api/config")
    def api_config():
        if request.args.get("reset"):
            live.reset()
            _mirror_to_sessions(None)
            return jsonify(ok=True, fields=live.snapshot())
        name = request.args.get("name")
        if name is None:
            return jsonify(ok=True, fields=live.snapshot())
        try:
            value = live.set(name, request.args.get("value", ""))
        except KeyError:
            return jsonify(ok=False, error="unknown setting"), 400
        except (TypeError, ValueError) as exc:
            return jsonify(ok=False, error=str(exc) or "invalid value"), 400
        _mirror_to_sessions(name)
        return jsonify(ok=True, name=name, value=value)

    def _mirror_to_sessions(name):
        if name is not None and name not in SESSION_MIRRORED:
            return
        for session in sessions.all():
            session.state.set_intensity(config.barrage_probability, config.jackpot_probability)

    @app.route("/api/novelty")
    def api_novelty():
        try:
            bonus = float(request.args.get("bonus", ""))
        except (TypeError, ValueError):
            return jsonify(ok=False, error="invalid value"), 400
        g.session.state.set_exploration_bonus(bonus)
        return jsonify(ok=True)

    @app.route("/api/rate")
    def api_rate():
        session = g.session
        try:
            index = int(request.args.get("screen", ""))
        except (TypeError, ValueError):
            return jsonify(ok=False, error="invalid screen index"), 400
        is_up = request.args.get("dir") == "up"
        reward = config.rate_up_reward if is_up else config.rate_down_reward
        path = session.state.current_path(index)
        library.reward_video(db, config, path, reward)
        try:
            strength = max(1, min(5, int(request.args.get("strength", 1))))
        except (TypeError, ValueError):
            strength = 1
        heart = library.heart_video(db, path, amount=strength) if is_up else None
        loop_anchor = None
        if is_up:
            try:
                position = float(request.args.get("pos", ""))
            except (TypeError, ValueError):
                position = None
            loop_anchor = library.bump_loop_anchor(db, path, position)
        return jsonify(ok=True, heart=heart, loop_anchor=loop_anchor)

    @app.route("/api/double_feature")
    def api_double_feature():
        screens = g.session.state.current_paths()
        if len(screens) < 2:
            return jsonify(ok=True, picked=False)
        index_a, index_b = random.sample(range(len(screens)), 2)
        pair = g.session.rotation.trigger_double_feature(index_a, index_b)
        if not pair:
            return jsonify(ok=True, picked=False)
        return jsonify(ok=True, picked=True, screens=[index_a, index_b])

    @app.route("/api/true_mystery")
    def api_true_mystery():
        # Searches the whole library, not just the current folder/session -
        # "something you've truly never seen" shouldn't be scoped to
        # whatever happens to be rotating today.
        try:
            index = int(request.args.get("screen", ""))
        except (TypeError, ValueError):
            return jsonify(ok=False, error="invalid screen index"), 400
        picked = library.pick_unplayed_video(db)
        if not picked:
            return jsonify(ok=True, picked=False)
        placed = g.session.rotation.force_screen(index, picked)
        return jsonify(ok=True, picked=placed)

    @app.route("/api/fresh_status")
    def api_fresh_status():
        # Re-scans on the way in so a clip dropped into media_assets mid-
        # session gets noticed without needing a page reload.
        library.sync_library(db, config)
        return jsonify(ok=True, waiting=len(library.fresh_video_paths(db)))

    @app.route("/api/fresh_drop")
    def api_fresh_drop():
        try:
            index = int(request.args.get("screen", ""))
        except (TypeError, ValueError):
            return jsonify(ok=False, error="invalid screen index"), 400
        if not (0 <= index < len(g.session.state.current_paths())):
            return jsonify(ok=False, error="screen index out of range"), 400
        path = library.pick_fresh_video(db)
        if not path:
            return jsonify(ok=True, picked=False, waiting=0)
        placed = g.session.rotation.force_screen(index, path)
        if placed:
            library.mark_debuted(db, path)
        return jsonify(ok=True, picked=placed, name=os.path.basename(path), waiting=len(library.fresh_video_paths(db)))

    @app.route("/api/video_meta")
    def api_video_meta():
        # Called once per clip load (not on the hot /api/stream snapshot -
        # most videos have nothing special here, and this only needs to be
        # known right as a tile's video actually loads, not on every 0.3s
        # poll). The client only ever sees the relativized path (see
        # _relative_media_path in build_status) - video_path in the DB is
        # absolute, so this has to convert back before looking it up.
        rel_path = request.args.get("path", "")
        abs_path = _absolute_media_path(config, rel_path)
        return jsonify(ok=True, **library.get_video_meta(db, abs_path))

    @app.route("/api/rate_audio")
    def api_rate_audio():
        return jsonify(ok=True)

    @app.route("/api/pace")
    def api_pace():
        try:
            mode = int(request.args.get("mode", ""))
            lo, hi, _label = config.pace_presets[mode]
        except (TypeError, ValueError, IndexError):
            return jsonify(ok=False, error="invalid pace mode"), 400
        g.session.state.set_pace(mode, lo, hi)
        return jsonify(ok=True)

    @app.route("/api/vector")
    def api_vector():
        key = request.args.get("key")
        try:
            val = float(request.args.get("val", ""))
        except (TypeError, ValueError):
            return jsonify(ok=False, error="invalid value"), 400
        if key == "binaural":
            g.session.state.set_binaural(val)
        return jsonify(ok=True)

    @app.route("/api/cycle_tone")
    def api_cycle_tone():
        g.session.state.cycle_tone()
        return jsonify(ok=True)

    # -- event log (dashboard_telemetry.js writes, /debug reads) --
    @app.route("/api/events", methods=["POST"])
    def api_events_post():
        payload = request.get_json(silent=True, force=True) or {}
        rows = []
        now = time.time()
        for ev in (payload.get("events") or [])[:EVENT_BATCH_MAX]:
            kind = str(ev.get("k", ""))[:48]
            if not kind:
                continue
            try:
                ts = float(ev.get("t", 0)) / 1000.0
            except (TypeError, ValueError):
                ts = 0
            if not (now - 86400 < ts < now + 3600):
                ts = now  # client clock way off (or missing) - fall back to arrival time
            data = ev.get("d")
            data_json = json.dumps(data, separators=(",", ":")) if data is not None else None
            if data_json and len(data_json) > EVENT_DATA_MAX:
                data_json = '{"truncated":true}'
            rows.append((ts, kind, data_json))
        if rows:
            db.add_events(g.session.id, rows)
        return jsonify(ok=True, stored=len(rows))

    @app.route("/api/events/sessions")
    def api_event_sessions():
        hours = request.args.get("hours", 24, type=float)
        rows = db.event_sessions(time.time() - hours * 3600)
        return jsonify(sessions=[dict(r) for r in rows])

    @app.route("/api/events")
    def api_events_get():
        session_id = request.args.get("session", "")
        if not session_id:
            recent = db.event_sessions(time.time() - 86400)
            if not recent:
                return jsonify(session=None, events=[])
            session_id = recent[0]["session"]
        rows = db.events_after(
            session_id,
            after_id=request.args.get("after", 0, type=int),
            since_ts=request.args.get("since", 0, type=float),
            limit=min(20000, request.args.get("limit", 5000, type=int)),
        )
        return jsonify(
            session=session_id,
            events=[{"id": r["id"], "t": r["ts"], "k": r["kind"], "d": json.loads(r["data"]) if r["data"] else None} for r in rows],
        )

    @app.route("/debug")
    def debug_view():
        return render_template("debug.html")

    return app
