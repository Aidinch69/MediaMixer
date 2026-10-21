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
- **ffmpeg.** Strongly recommended. `Setup.bat` offers to download it into the project folder. Without it, clips still play, but there are no proxies (smooth playback with many tiles) and no Clip DNA (smart picking, framing, hooks and more).
- **A modern browser.** Chrome or Edge works best.

## Quick start

1. **Get the code.** Clone the repo or download it as a ZIP and unzip it anywhere.
2. **Run `Setup.bat`.** It checks Python, installs the packages (`flask`, `waitress`, `qrcode`) and checks for ffmpeg, offering to download anything missing (no winget or admin rights needed). It also asks whether to turn on **background prep** and whether to add a **MediaMixer shortcut** to the Desktop and Start menu (see [below](#library-prep-proxies-and-clip-dna)).
3. **Start it** with the **MediaMixer shortcut** or `Run.bat`. The shortcut opens the dashboard in its own app window (Chrome or Edge, with no tabs or address bar). `Run.bat` opens it in a browser tab at <http://localhost:5000>. Either way, a black console window runs the engine. The shortcut starts it minimized, and closing the MediaMixer app window stops the engine too (after about 45 seconds, so a reload or a phone reconnecting doesn't). With `Run.bat`, closing the console window stops MediaMixer.
4. **Choose your folders.** In the dashboard menu (✕ / ☰ at the top right), open the **⚙️ More** tab → **📁 Sources** and add the folders your clips are in (see [Sources](#your-media-sources-and-folders)). Alternatively, drop clips into the `media_assets` folder that appears next to `Run.bat`.
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

**New clips.** New clips are picked up automatically, with no reload. Clips added to a folder that's already in the library debut one at a time as **Fresh Drops**. Only 6 are held back for these reveals; the rest of a big batch joins rotation straight away. A whole folder added as a new source joins straight in.

Video formats: `.mp4 .mkv .avi .mov .webm`. Overlay images: `.jpg .png .gif .webp`.

---

## Scripts and tools

| Script | What it does |
|---|---|
| `Setup.bat` | One-time setup on a new PC: Python check, packages, ffmpeg (downloaded into `ffmpeg\`), optional background prep and an optional app shortcut. Safe to run again. |
| `Run.bat` | Starts MediaMixer and opens the dashboard. If it's already running, it just opens the dashboard. Stop it by closing the window or pressing Ctrl+C. `Run.bat --app` opens it in an app window; this is what the shortcut runs. |
| `Prepare.bat` | Builds proxies and Clip DNA for the whole library, with progress, then exits. Works whether or not MediaMixer is running. `Prepare.bat --watch` keeps going and picks up new clips every 10 minutes. `--workers 4` runs more transcodes at once. |
| `Uninstall.bat` | Stops MediaMixer and removes background prep from login. It then asks, separately, whether to delete the proxy cache, your history and settings, and the Python packages. It never touches your media; afterwards, delete the project folder to finish. |
| `mediamixer\install_shortcuts.ps1` | Adds the MediaMixer shortcut (`-Uninstall` removes it). `Setup.bat` offers this. |
| `mediamixer\install_cache_warmer.ps1` | Turns background prep on (it starts hidden at every login). `Setup.bat` runs this for you. Add `-Uninstall` to turn it off. |

`Run.bat` is just `python Engine.py --open` run from the project folder. It adds no delay and has no performance cost. You can also run things directly from a terminal in the project folder:

```
python Engine.py [--open | --app] [--port 5050] [--host 127.0.0.1]
python -m mediamixer.prepare [--watch] [--workers N] [--no-proxies] [--no-dna]
```

## Library prep: proxies and Clip DNA

Two kinds of background work make the experience better. Neither is required for playback.

- **Proxies** are small, light copies of each clip (640px, about 1.2 Mbps), so many tiles can play at once without stutter. They're stored in `media_proxies/` in the project folder, never inside your source folders, with one subfolder per source folder. Delete that folder any time and the proxies are rebuilt.
- **Clip DNA** is a one-off look at every clip: brightness, motion, colour, rhythm and peak moments. It's used for energy-aware picking, smart framing, hooks, gradients, beat-matching and more.

What happens when:

| | MediaMixer running | MediaMixer not running |
|---|---|---|
| **Proxies** | Built in the background, one at a time at low priority. Any clip that plays before its proxy is ready plays the original. | Built by background prep, if turned on, or by `Prepare.bat`. |
| **Clip DNA** | Analysed in the background, one clip at a time, at low priority. | Analysed by background prep, if turned on, or by `Prepare.bat`. |

While MediaMixer runs, it rescans your source folders every minute, and right away when you change folders in Sources, so new clips start getting prepared within seconds.

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
- **Top bar:** an always-on charge meter for jackpots. Your level and XP are shown top right.
- **Session card:** when you come back after 30+ minutes, choose 🌊 Drift, 🎢 Ride, ⚡ Chaos or one of your Scenes, plus an optional length. With a length set, the session winds down gently over its last 5 minutes.

**Top of the menu (always there)**

- **Now Playing:** the current audio track with **⏭ Next**, plus **🔒 Lock 60s** (every tile keeps its clip for a minute) and **⏩ Skip all** (every tile changes now).
- **⚡ Performance chip:** shows Auto, Full or Light; tap it to switch.
- **Quick switches:** one-tap toggles for 🤖 Auto-Pilot, 🌊 Shared Pulse, 🥁 Rhythm and 🌀 Spiral.
- **🔍 Search every setting:** type a few letters (for example *spiral*, *volume* or *odds*) and pick a result to jump straight to it, including settings in Master Controls.

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

Every control has a small **ⓘ**: tap it for a one- or two-sentence explanation of just that option. Each section also keeps a longer **📖 Full details** at the bottom.

**🏠 Home**

- **⏱️ Play Time:** minutes watched today, this week, this month and in all, plus a five-week calendar and your visit streak. Time counts while the dashboard is visible and you've used it in the last 3 minutes (adjustable in Master → Session & Finale). Several devices watching at once count once. It's kept per install, so your phone adds to the PC it connects to.
- **⭐ Level & Prestige:** your level, XP to the next one, your prestige count and your permanent XP bonus. Levels get steadily harder: level 5 takes a couple of hours, level 20 about a day of watching. At level 20 you can prestige: your level resets and each prestige adds +5% to all XP you earn, up to +50%. The curve, prestige level, bonus and cap are adjustable in Master → Progress & Prestige.
- **🧭 Session:** the session card, the opt-in session timer, and wind-down.
- **🎯 Challenges:** three daily and three weekly challenges drawn from a larger pool (hearts, jackpots, MEGAs, chase chains, spins, Moments, Overdrive and more). Each week includes a play-time goal from 2 up to 50 hours. Clearing all three dailies pays a sweep bonus and all three weeklies a Perfect Week bonus. 🎲 swaps one daily per day. The Weekly Arc runs alongside.
- **🏆 Achievements & Bests:** permanent badges (play hours, long days and big weeks, days played, levels, prestige, lifetime counts, challenges completed) with a running count, and progress bars for the ones still locked. Also lifetime bests, this session's recap and insights.

**🖥️ Look**

- **Layout & Pace:** tile count (2 up to 64), preload, Mosaic Fit (tiles shaped to each clip), tile gestures, a speed override, and **Performance**. Performance is Auto by default: on a device that keeps dropping video frames, typically a laptop with built-in graphics, it switches to Light by itself. Light drops the heaviest effects and gives floaters rounded corners instead of a feathered edge.
- **Dynamic Mosaic:** the tile count changes by itself, driven by zone or drifting freely, within a range you set.
- **Crop Focus & Gravity:** Mosaic crops toward the action; the liveliest tile can swell slightly.
- **Living Screen:** breathing tiles, slow-mo moments, double exposures, smart framing, colour mood.
- **Visual Textures:** split frames, film grain, edge bleed.
- **Hooks & Tease:** a clip's best moment repeats like a song's hook; some clips arrive pushed in close.
- **Floating Overlay:** clips that drift across the screen like a DVD logo, from your Overlay Source, the library, or both.
- **Manual Spiral:** keep a spiral of your choice up, at your own opacity.
- **Mantra Text:** your own phrases drifting, flashing or pulsing on the beat.

**🎵 Sound**

- **Device Audio:** binaural tone and beat, with Brainwave presets (Delta 2.5 / Theta 6 / Alpha 10 / Beta 15 / Gamma 40 Hz, or Mood), and every volume in one place: binaural tone, overlay track, beat sound, tile audio and sound effects. Also Spatial Sound. Use headphones for the binaural effect.
- **Rhythm Mode:** everything to do with the beat: tempo and where it comes from, tempo waves, the beat pattern and sound, stutter edits, cascades, cut on the beat, beat-matching and Visual Tone.
- **Audio-Reactive FX:** edge glow and tile pulses from what you hear.

**🎬 Flow**

- **Auto-Pilot:** cycle length, the current zone and zone Scenes.
- **Discovery Vibe:** familiar favourites versus fresh clips.
- **Taste Learning:** leans effects, beat patterns and clip picks toward what you heart, never away from variety.
- **Content Pulse:** movement in the clips drives energy and glow; cuts wait for a clip's peak.
- **Clip DNA:** analysis progress, plus Gradient moments (dark → light, cool → warm, calm → wild).
- **Shared Pulse:** spirals, the binaural beat and glows follow one energy signal.
- **Fresh Drops:** new clips debut one at a time (only 6 wait for this; the rest of a big batch plays straight away).
- **Finale:** see above.

**🎰 Rewards**

- **Barrages:** how often a few tiles get highlighted with the rest dimmed.
- **Anticipation:** build-ups and payoffs, bonus and sealed tiles, chase flashes, jackpots, Golden Hour.
- **Moments:** The Drop, Breath, Countdown, Focus Pull, Call & Response, Echo Trails, Favourite Takeover, Heart Echo, Heart Burst.
- **Replays & Callbacks:** instant replays of what you just hearted, and earlier favourites returning.
- **Visual FX Rewards:** prism, bloom, duotone, light leak, zoom, RGB split, VHS, shockwave.

**🎞️ Scenes:** your saved looks. Tap one to apply it, **＋ Save current** to add one, 💾 to update it, ✏️ to rename and 🗑️ to delete. Scenes are shared by every device on the install. To have a scene blend in when an Auto-Pilot zone starts, link it in Flow → Auto-Pilot → Zone Scenes.

**🔧 Master:** every adjustable number in one searchable list, grouped by the same tabs.

- **Changed only** shows what you've changed.
- **↺** resets one setting.
- **Save Backup** and **Restore Backup** snapshot your settings.
- **📋 Copy everything I've changed** lists your changes, which is useful for making them the new defaults.
- Settings marked 🖧 belong to the engine: they're shared by every device and kept across restarts. Everything else is saved per device.
- Settings marked *(reload to apply)* take effect after the page is reloaded.

**⚙️ System**

- **📁 Sources:** your folders (see above).
- **📱 Phone Access:** a QR code for your phone.
- **📂 Categories:** jump to a category.
- **🛰️ Observability:** Auto-Pilot's live state, plus a link to the **/debug** page (event timeline, hit rates, what gets liked, and a **Playback** line counting clips that failed to play or stalled).

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
| Dashboard settings, XP, challenges, achievements, toggles | The browser's local storage (per device) | Master → ⟲ Reset dashboard settings |
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
| Choppy with many tiles, or tiles freezing | On a laptop or PC with built-in graphics, set Screen → Layout & Pace → Performance to **Light** (Auto does this on its own after about 20 seconds of dropped frames). Check that every clip has a proxy (progress is in More → Sources); run `Prepare.bat` to build them all now. Make sure ffmpeg is installed. Fewer tiles helps on slower PCs. **/debug → Rewards & pacing → Playback** shows which clips stalled or failed. **/debug → ⬇ Export diagnostics** saves one file with everything needed to look into it: this PC's details, drive speed, the clips that stalled, and the logs. It includes clip names and folder paths. A clip whose proxy won't play is retried from the original, and the proxy is rebuilt. |
| A clip never gets a proxy | ffmpeg couldn't convert it. A `.failed` file next to where its proxy would be (in `media_proxies`) holds the error; delete that file to retry. |
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
