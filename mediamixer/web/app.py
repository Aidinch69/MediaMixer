"""Flask app: dashboard UI, media streaming, and the control/telemetry API."""
from __future__ import annotations

import io
import json
import logging
import os
import time

import qrcode
import qrcode.image.svg
from flask import Flask, Response, jsonify, render_template, request, send_from_directory

from .. import library
from ..context import AppContext
from ..network import get_lan_ip

log = logging.getLogger(__name__)

_HERE = os.path.dirname(__file__)
STREAM_INTERVAL_S = 0.3


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


def create_app(ctx: AppContext) -> Flask:
    app = Flask(
        __name__,
        template_folder=os.path.join(_HERE, "templates"),
        static_folder=os.path.join(_HERE, "static"),
        static_url_path="/assets",
    )
    logging.getLogger("werkzeug").setLevel(logging.ERROR)

    config, db, state = ctx.config, ctx.db, ctx.state
    overlay, rotation = ctx.overlay, ctx.rotation

    def build_status() -> dict:
        snap = state.snapshot()
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
        carrier_hz, beat_hz, iso = state.synth_params()
        return {
            "layout": snap["layout"],
            "columns": _layout_columns(config, snap["layout"]),
            "folder": snap["folder"] or "none",
            "screens": screens,
            "audio_name": overlay.current_name(),
            "audio_path": _relative_audio_path(config, overlay.current_path()),
            "audio_available": bool(overlay.tracks),
            "synth": {"carrier_hz": carrier_hz, "beat_hz": beat_hz, "iso": iso},
            "lock_label": (
                "Continuous Mode"
                if pace_idx == 3
                else f"Cycle: {snap['played']}/{config.folder_rotation_limit} clips"
            ),
            "jackpot": snap["jackpot"],
            "barrage": snap["barrage"],
            "preload_enabled": snap["preload_enabled"],
        }

    @app.route("/")
    def dashboard():
        library.sync_library(db, config)
        snap = state.snapshot()
        pace_idx = snap["pace_idx"]
        phone_url = f"http://{get_lan_ip()}:{config.port}"
        return render_template(
            "dashboard.html",
            folders=library.list_folders(config),
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
        return send_from_directory(config.media_dir, filename)

    @app.route("/audio/<path:filename>")
    def audio_file(filename):
        return send_from_directory(config.audio_dir, filename)

    @app.route("/api/status")
    def api_status():
        if not any(state.current_paths()):
            return jsonify(folder="none", screens=[])
        return jsonify(**build_status())

    @app.route("/api/stream")
    def api_stream():
        def generate():
            last = None
            while True:
                payload = json.dumps(build_status())
                if payload != last:
                    yield f"data: {payload}\n\n"
                    last = payload
                else:
                    yield ": keep-alive\n\n"
                time.sleep(STREAM_INTERVAL_S)

        return Response(generate(), mimetype="text/event-stream")

    @app.route("/api/skip")
    def api_skip():
        state.request_skip()
        return jsonify(ok=True)

    @app.route("/api/lock")
    def api_lock():
        state.request_lock()
        return jsonify(ok=True)

    @app.route("/api/next_audio")
    def api_next_audio():
        overlay.next_track()
        return jsonify(ok=True)

    @app.route("/api/preload")
    def api_preload():
        enabled = request.args.get("enabled", "").lower() == "true"
        state.set_preload_enabled(enabled)
        return jsonify(ok=True)

    @app.route("/api/rotate")
    def api_rotate():
        """Called by the browser when a tile's clip finishes naturally, so a clip
        shorter than its rotation window advances immediately instead of freezing
        on its last frame until the timer catches up."""
        try:
            index = int(request.args.get("screen", ""))
        except (TypeError, ValueError):
            return jsonify(ok=False, error="invalid screen index"), 400
        if not (0 <= index < len(state.current_paths())):
            return jsonify(ok=False, error="screen index out of range"), 400
        rotation.rotate(side=index)
        return jsonify(ok=True)

    @app.route("/api/folder")
    def api_folder():
        folder = request.args.get("folder", "")
        if folder not in library.list_folders(config):
            return jsonify(ok=False, error="unknown folder"), 400
        rotation.rotate(override_folder=folder, side="all")
        return jsonify(ok=True)

    @app.route("/api/layout")
    def api_layout():
        name = request.args.get("mode", "")
        if name not in {preset.name for preset in config.layout_presets}:
            return jsonify(ok=False, error="unknown layout"), 400
        preset = state.set_layout(name)
        rotation.rotate(side="all")
        return jsonify(ok=True, tile_count=preset.tile_count, columns=preset.columns)

    @app.route("/api/rate")
    def api_rate():
        try:
            index = int(request.args.get("screen", ""))
        except (TypeError, ValueError):
            return jsonify(ok=False, error="invalid screen index"), 400
        reward = config.rate_up_reward if request.args.get("dir") == "up" else config.rate_down_reward
        library.reward_video(db, config, state.current_path(index), reward)
        return jsonify(ok=True)

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
        state.set_pace(mode, lo, hi)
        return jsonify(ok=True)

    @app.route("/api/vector")
    def api_vector():
        key = request.args.get("key")
        try:
            val = float(request.args.get("val", ""))
        except (TypeError, ValueError):
            return jsonify(ok=False, error="invalid value"), 400
        if key == "binaural":
            state.set_binaural(val)
        return jsonify(ok=True)

    @app.route("/api/cycle_tone")
    def api_cycle_tone():
        state.cycle_tone()
        return jsonify(ok=True)

    return app
