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
import time

import qrcode
import qrcode.image.svg
from flask import Flask, Response, g, jsonify, render_template, request, send_from_directory

from .. import library, proxy
from ..context import AppContext
from ..network import get_lan_ip, get_tailscale_https_url
from ..session import Session

log = logging.getLogger(__name__)

_HERE = os.path.dirname(__file__)
STREAM_INTERVAL_S = 0.3
_NO_SESSION_PREFIXES = ("/media/", "/audio/", "/overlay_fx/", "/spirals/", "/assets/", "/sw.js")


def _relative_media_path(config, path: str) -> str:
    if not path:
        return ""
    return os.path.relpath(path, config.media_dir).replace("\\", "/")


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

    @app.before_request
    def _load_session():
        if request.path.startswith(_NO_SESSION_PREFIXES):
            return
        session_id = request.cookies.get(config.session_cookie_name)
        session = sessions.get(session_id)
        if session is None:
            session = sessions.create()
            g.new_session_id = session.id
        g.session = session

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
            items = [{"path": p, "kind": "video", "base": "/media/"} for p in library.list_all_videos(config)]
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
        try:
            barrage_p = float(request.args.get("barrage", ""))
            jackpot_p = float(request.args.get("jackpot", ""))
        except (TypeError, ValueError):
            return jsonify(ok=False, error="invalid value"), 400
        g.session.state.set_intensity(barrage_p, jackpot_p)
        return jsonify(ok=True)

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
        return jsonify(ok=True, heart=heart)

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

    return app
