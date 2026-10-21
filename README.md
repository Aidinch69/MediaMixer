# MediaMixer

MediaMixer plays your own video clips as a live, multi-tile mix in the browser. Heart the clips you like and it learns what to show you more of. Layered on top are spirals, floating overlays, binaural audio, a beat, and a reward system (jackpots, barrages, spins). An Auto-Pilot can run a whole session for you.

It runs on your PC as a small local server. Open the dashboard in a browser on that PC, or on your phone or tablet on the same network.

---

## Contents

- [Requirements](#requirements)
- [Quick start](#quick-start)
- [Your media: sources and folders](#your-media-sources-and-folders)
- [Scripts and tools](#scripts-and-tools)
- [Library prep: proxies and Clip DNA](#library-prep-proxies-and-clip-dna)
- [Using the dashboard](#using-the-dashboard)
- [Menu reference](#menu-reference)
- [Other devices](#other-devices)
- [Settings, data and resetting](#settings-data-and-resetting)
- [Command-line and advanced options](#command-line-and-advanced-options)
- [Troubleshooting](#troubleshooting)
- [For developers](#for-developers)

---

## Requirements

- **Windows 10/11.** The scripts are Windows batch files. The Python code itself is cross-platform.
- **Python 3.10 or newer.** `Setup.bat` offers to install it.
- **ffmpeg.** Strongly recommended. `Setup.bat` offers to install it. Without it, clips still play, but there are no proxies (smooth playback with many tiles) and no Clip DNA (smart picking, framing, hooks and more).
- **A modern browser.** Chrome or Edge works best.

## Quick start

1. **Get the code.** Clone the repo or download it as a ZIP and unzip it anywhere.
2. **Run `Setup.bat`.** It checks Python, installs the packages (`flask`, `waitress`, `qrcode`) and checks for ffmpeg, offering to install anything missing. It also asks whether to turn on **background prep** (see [below](#library-prep-proxies-and-clip-dna)).
3. **Run `Run.bat`.** The engine starts and the dashboard opens in your browser at <http://localhost:5000>. Keep the black window open while you use it; closing it stops MediaMixer.
4. **Choose your folders.** In the dashboard menu (✕ / ☰ at the top right), open **⚙️ More → 📁 Sources** and add the folders your clips are in (see [Sources](#your-media-sources-and-folders)). Alternatively, drop clips into the `media_assets` folder that appears next to `Run.bat`.
5. *(Optional)* **Run `Prepare.bat`** once to build proxies and Clip DNA for the whole library up front. Otherwise this happens gradually in the background.

That's it. Heart (👍) the tiles you like and it learns as you go.

---

## Your media: sources and folders

MediaMixer reads from four kinds of source. You can give each one **one folder or several**. Every folder is searched **all the way down through its subfolders**, so you can pick the parent folder of an entire library.

| Source | What it's for | Default folder (if you pick none) |
|---|---|---|
| **Tile Source** | The clips that play in the tiles. | `media_assets/` |
| **Spiral Source** | Full-screen spiral videos that fade in over everything. | `Spirals/` |
| **Overlay Source** | Videos or images used by the Floating Overlay. | `overlay_fx/` |
| **Audio Source** | Background audio tracks (mp3 / wav / ogg). | `Audios/` |

Set them in **⚙️ More → 📁 Sources**: **＋ Add folder** opens a folder browser, **✕** removes a folder, and **↺ Use default** goes back to the project folder. Changes apply immediately, with no restart.

**Categories (Tile Source).** Inside each tile folder, every **top-level subfolder is a category**. The engine learns which categories you prefer as well as which clips, and you can jump to one in **⚙️ More → 📂 Categories**. Anything deeper still belongs to its top-level folder. Files sitting loose in the folder itself go into a category called **General**. For example:

```
D:\Clips\                 <- added as a Tile Source
├── Beach\                <- category "Beach"
│   ├── 2024\June\a.mp4   <- counts as "Beach"
│   └── b.mp4             <- "Beach"
├── City\c.mp4            <- category "City"
└── d.mp4                 <- category "General"
```

If you pick several tile folders, categories with the same name are merged.

**Skipped folders.** Folders whose names start with `_` or `.` are skipped (handy for an `_archive`), as is the proxy folder.

**Removing a folder doesn't forget anything.** Its clips just sit out until the folder is added back, with their hearts and history intact. The same goes for an unplugged external drive.

**New clips.** New clips are picked up automatically, with no reload. Clips added to a folder that's already in the library debut one at a time as **Fresh Drops**. A whole folder added as a new source joins straight in.

Video formats: `.mp4 .mkv .avi .mov .webm`. Overlay images: `.jpg .png .gif .webp`.

---

## Scripts and tools

| Script | What it does |
|---|---|
| `Setup.bat` | One-time setup on a new PC: Python check, packages, ffmpeg, and optional background prep. Safe to run again. |
| `Run.bat` | Starts MediaMixer and opens the dashboard. If it's already running, it just opens the dashboard. Stop it by closing the window or pressing Ctrl+C. |
| `Prepare.bat` | Builds proxies and Clip DNA for the whole library, with progress, then exits. Works whether or not MediaMixer is running. `Prepare.bat --watch` keeps going and picks up new clips every 10 minutes. `--workers 4` runs more transcodes at once. |
| `Uninstall.bat` | Stops MediaMixer and removes background prep from login. It then asks, separately, whether to delete the proxy cache, your history and settings, and the Python packages. It never touches your media; afterwards, delete the project folder to finish. |
| `mediamixer\install_cache_warmer.ps1` | Turns background prep on (it starts hidden at every login). `Setup.bat` runs this for you. Add `-Uninstall` to turn it off. |

`Run.bat` is just `python Engine.py --open` run from the project folder. It adds no delay and has no performance cost. You can also run things directly from a terminal in the project folder:

```
python Engine.py [--open] [--port 5050] [--host 127.0.0.1]
python -m mediamixer.prepare [--watch] [--workers N] [--no-proxies] [--no-dna]
```

## Library prep: proxies and Clip DNA

Two kinds of background work make the experience better. Neither is required for playback.

- **Proxies** are small, light copies of each clip (640px, about 1.2 Mbps), so many tiles can play at once without stutter. They're stored in `media_proxies/` in the project folder, never inside your source folders, with one subfolder per source folder. Delete that folder any time and the proxies are rebuilt.
- **Clip DNA** is a one-off look at every clip: brightness, motion, colour, rhythm and peak moments. It's used for energy-aware picking, smart framing, hooks, gradients, beat-matching and more.

What happens when:

| | MediaMixer running | MediaMixer not running |
|---|---|---|
| **Proxies** | Made on demand the first time a clip plays (it plays the original until the proxy is ready). | Built by background prep, if turned on, or by `Prepare.bat`. |
| **Clip DNA** | Analysed in the background, one clip at a time, at low priority. | Analysed by background prep, if turned on, or by `Prepare.bat`. |

All of these can run together safely. Files are written to a temporary name and then renamed, so interrupted work is never half-finished, and anything already being transcoded is skipped. Stopping at any point is fine; the next run continues where it left off. **⚙️ More → 📁 Sources** shows how much of the library has proxies and DNA. Background prep logs to `cache_warmer.log`.

---

## Using the dashboard

**On the tiles**

- **👍 / 👎** (hover a tile): heart or skip a clip. Hearts are the main signal the engine learns from.
- **Swipe** a tile: swap it for a new clip.
- **Long-press**: 📌 pin a tile so it keeps its clip.
- **Double-tap**: ✨ *More like this*. Similar-looking clips fill in for a minute.
- **Scroll** over a tile: change that tile's playback speed.

**On screen**

- **🎰 Spin:** pull for a chance at a bonus (FX bursts, XP, charges). Spins have a cooldown.
- **Overdrive meter:** fills as you heart, catch and claim. Release it (click, or press **O**) when you want a peak.
- **🎬 Scenes bar:** a Scene is a saved look (screen, flow and sound settings). **＋ Save current** saves one; tap a scene to apply it, 💾 updates it. Scenes are shared by every device.
- **Quick switches:** one-tap toggles for 🤖 Auto-Pilot, 🌊 Shared Pulse, 🥁 Rhythm and 🌀 Spiral.
- **Top bar:** an always-on charge meter for jackpots. XP and level are shown top right.
- **Session card:** when you come back after 30+ minutes, choose 🌊 Drift, 🎢 Ride, ⚡ Chaos or one of your Scenes, plus an optional length. With a length set, the session winds down gently over its last 5 minutes.

**Auto-Pilot** runs the session in repeating calm → building → climax → cooldown cycles. Each cycle leans into a different zone:

| Zone | Feel |
|---|---|
| **Chase** | Chase flashes that hop between tiles. |
| **Color** | Colour Rush and splashes. |
| **Jackpot** | Jackpot-heavy. |
| **Vault** | Low, focused, with sealed tiles. |
| **Rhythm** | Built around the beat. |

Zones last longer while you're engaged and end sooner if you're not. You can link a zone to a Scene. **Finale** is one long build to a big climax, then an afterglow and a recap of the session.

---

## Menu reference

Every section in the menu has a **"What does this do?"** link with the full details. In brief:

**🖥️ Screen**

- **Layout & Pace:** tile count (2 up to 64), preload, Mosaic Fit (sizes tiles to each clip's shape) and a speed override.
- **Dynamic Mosaic:** the tile count changes by itself, driven by zone or drifting freely, within a range you set.
- **Floating Overlay:** clips that drift across the screen like a DVD logo, either from the library or your Overlay Source.
- **Living Screen:** breathing tiles, slow-mo moments, double exposures, smart framing, colour mood.
- **Visual Textures:** split frames, film grain, edge bleed.
- **Hooks & Tease:** a clip's best moment repeats like a song's hook; some clips arrive pushed in close.
- **Crop Focus & Gravity:** Mosaic crops toward the action; the liveliest tile can swell slightly.
- **Manual Spiral:** keep a spiral of your choice up, at your own opacity.
- **Mantra Text:** your own phrases drifting, flashing or pulsing on the beat.

**🌊 Flow**

- **Content Pulse:** movement in the clips drives energy, glow and (optionally) the beat; cuts wait for a clip's peak.
- **Session:** the session card and wind-down.
- **Auto-Pilot:** cycle length, zones and zone Scenes.
- **Clip DNA:** progress, plus Gradient moments (dark → light, cool → warm, calm → wild).
- **Shared Pulse:** spirals, binaural and glow follow one energy signal.
- **Rhythm Mode:** a beat the grid moves to, with beat sounds, patterns, tempo waves, Follow Audio / Follow Clips, stutter edits and beat-matching.
- **Discovery Vibe:** familiar favourites versus fresh clips.
- **Taste Learning:** leans FX, beat patterns and clip picks toward what you heart, never away from variety.
- **Fresh Drops:** new clips debut one at a time.
- **Finale:** see above.

**🎰 Rewards**

- **Barrages:** how often a few tiles get highlighted with the rest dimmed.
- **Replays & Callbacks:** instant replays of what you just hearted, and earlier favourites returning.
- **Moments:** The Drop, Breath, Countdown, Focus Pull, Call & Response, Echo Trails, Favourite Takeover, Heart Echo, Heart Burst.
- **Anticipation:** build-ups and payoffs, bonus and sealed tiles, chase flashes, jackpots, Golden Hour.
- **Visual FX Rewards:** prism, bloom, duotone, light leak, zoom, RGB split, VHS, shockwave.
- **Progress & Challenges:** lifetime bests, daily quests, weekly arcs, visit streaks, trophies.

**🎵 Sound**

- **Device Audio:** binaural tone and beat, with Brainwave presets (Delta 2.5 / Theta 6 / Alpha 10 / Beta 15 / Gamma 40 Hz, or Mood). Also the overlay track, Tile Audio and Spatial Sound. Use headphones for the binaural effect.
- **Audio-Reactive FX:** edge glow and tile pulses from what you hear.

**🔧 Master:** every adjustable number in one searchable list.

- **Changed only** shows what you've changed.
- **↺** resets one setting.
- **Save Backup** and **Restore Backup** snapshot your settings.
- **📋 Copy everything I've changed** lists your changes, which is useful for making them the new defaults.
- Settings marked 🖧 belong to the engine: they're shared by every device and kept across restarts. Everything else is saved per device.

**⚙️ More**

- **📁 Sources:** your folders (see above).
- **📱 Phone Access:** a QR code for your phone.
- **📂 Categories:** jump to a category.
- **🕹️ Overrides:** lock or skip manually.
- **🛰️ Observability:** Auto-Pilot's live state, plus a link to the **/debug** page (event timeline, hit rates, what gets liked).

---

## Other devices

- **Same Wi-Fi.** Open **⚙️ More → 📱 Phone Access** and scan the QR code, or go to `http://<this PC's IP>:5000`. The address is also printed in the `Run.bat` window. Each device gets its own independent session.
- **Anywhere, via Tailscale.** If [Tailscale](https://tailscale.com) is installed and signed in, the console also prints an HTTPS address for your tailnet. Over HTTPS the dashboard can be installed as an app.
- **Firewall.** The first run may trigger a Windows Firewall prompt. Allow private networks so your phone can connect.

There's no login. Anyone on your network who knows the address can open the dashboard, so only run MediaMixer on networks you trust.

## Settings, data and resetting

Everything lives in the project folder, apart from per-device settings in the browser.

| What | Where | Reset by |
|---|---|---|
| Hearts, play history, categories, Clip DNA, Scenes, chosen source folders, event log (14 days) | `system_memory.db` | Deleting it while MediaMixer is stopped. It's recreated empty and clips are re-analysed. |
| Engine settings changed in the menu (🖧) | `config_overrides.json` | Master → ⟲ Reset engine settings, or deleting the file |
| Dashboard settings, XP, trophies, toggles | The browser's local storage (per device) | Master → ⟲ Reset dashboard settings |
| Proxies | `media_proxies/` | Deleting the folder (they're rebuilt) |
| Logs | `engine_stdout.log`, `engine_stderr.log`, `cache_warmer.log` | Safe to delete |

None of these, nor your media folders, are committed to git (see `.gitignore`). `Uninstall.bat` can delete the generated files for you.

**Moving to another PC.** Copy or clone the project, run `Setup.bat`, then pick your folders in Sources. To bring your history along, copy `system_memory.db` too. History is stored by each clip's full file path, so it carries over when the clips sit at the same paths. Otherwise you start fresh and it relearns.

## Command-line and advanced options

`python Engine.py` takes `--open` (open the browser), `--port N`, `--host ADDR` and `--log-level DEBUG`.

Environment variables (optional; relative paths are resolved against the project folder):

| Variable | Default | |
|---|---|---|
| `MEDIAMIXER_MEDIA_DIR` | `media_assets` | Default Tile Source |
| `MEDIAMIXER_SPIRALS_DIR` | `Spirals` | Default Spiral Source |
| `MEDIAMIXER_OVERLAY_FX_DIR` | `overlay_fx` | Default Overlay Source |
| `MEDIAMIXER_AUDIO_DIR` | `Audios` | Default Audio Source |
| `MEDIAMIXER_PROXY_DIR` | `media_proxies` | Where proxies are stored |
| `MEDIAMIXER_DB_PATH` | `system_memory.db` | The database |
| `MEDIAMIXER_CONFIG_OVERRIDES` | `config_overrides.json` | Saved engine settings |
| `MEDIAMIXER_FFMPEG` | *(searched)* | Full path to `ffmpeg.exe` |

ffmpeg is searched for in this order: `MEDIAMIXER_FFMPEG`, then an `ffmpeg\` folder in the project (`ffmpeg\ffmpeg.exe` or `ffmpeg\bin\ffmpeg.exe`), then your PATH, then the default winget install location. `ffprobe` must sit next to it.

Every engine default (pace presets, layouts, reward weights, odds) is in `mediamixer/config.py`. Edits there need a restart.

## Troubleshooting

| Problem | Fix |
|---|---|
| `Run.bat` closes or shows "not set up" | Run `Setup.bat`. If Python was just installed, open a new window first. |
| "Address already in use" / port 5000 busy | Another program is using it. Use `Run.bat --port 5050`. |
| Phone can't connect | It must be on the same Wi-Fi network. Allow Python through Windows Firewall (private networks). Use the IP shown in Phone Access. |
| Choppy with many tiles | The proxies aren't built yet. Run `Prepare.bat` and watch progress in More → Sources. Make sure ffmpeg is installed. |
| "ffmpeg not found" | Run `Setup.bat`, or unzip an ffmpeg build into an `ffmpeg\` folder in the project. |
| A folder shows "⚠️ not found" | The drive is unplugged or the folder moved. Its clips sit out until it's back, or remove the folder and add its new location. |
| New clips don't show | They appear within a couple of minutes (Fresh Drops debut one at a time). Check that the extension is supported and the folder name doesn't start with `_`. |
| No sound from tiles | Tile Audio defaults to 0%. Turn it up in Sound → Device Audio. |

## For developers

```
pip install -r requirements-dev.txt
python -m pytest                 # unit tests (temp DB and media, never your real library)
python tools/smoke.py            # with the engine running: headless Chrome walks the layouts, fails on any JS error
```

Project layout:

```
Engine.py                 entry point (python Engine.py)
mediamixer/
  app.py                  wires everything up, starts the web server and Clip DNA worker
  config.py               every engine default
  sources.py              source folders: scanning, ids, proxy paths, folder browser
  library.py              library sync and reward-weighted picking
  rotation.py, state.py, session.py   per-viewer playback engine
  db.py                   SQLite storage
  proxy.py, clip_dna.py   ffmpeg proxies and clip analysis
  prepare.py, cache_warmer.py         standalone library prep
  live_config.py          engine settings editable from the menu
  insights.py             session recap and /debug stats
  web/                    Flask app, dashboard template, front-end scripts (dashboard_*.js) and CSS
tests/                    pytest suite
tools/                    cdp.py (headless Chrome driver), smoke.py
```

The front end is plain JavaScript with no build step. The `dashboard_*.js` files share one global scope and are loaded in order by `web/templates/dashboard.html`. Template edits need an engine restart; JS and CSS edits only need a browser refresh.
