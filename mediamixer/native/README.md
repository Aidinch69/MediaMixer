# Native desktop viewer - setup

One-time setup, since the required binaries aren't committed to git:

1. `pip install PySide6 python-mpv requests`
2. Download a "dev" build (includes `libmpv-2.dll`, not just `mpv.exe`) from
   https://github.com/zhongfly/mpv-winbuild/releases - grab the asset named
   `mpv-dev-x86_64-<date>-git-<hash>.7z` (plain `x86_64`, not `v3`/`aarch64`
   unless you know your CPU supports the v3 instruction set).
3. Extract it (7-Zip) and copy `libmpv-2.dll` into `native_deps/` at the
   project root (sibling of `mediamixer/`, `media_assets/`, etc.) - create
   that folder if it doesn't exist.

## Run

With the Flask engine already running (`python Engine.py` / `Run.bat`):

```
python -m mediamixer.native.main
```

This opens a native window that becomes its own independent viewer session
(same as a browser tab or phone), talking to the existing backend over
loopback HTTP - it doesn't change or replace anything server-side.
