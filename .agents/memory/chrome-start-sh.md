---
name: Chrome library & start.sh
description: How start.sh resolves Chrome binary and Nix library paths for dev and deployment containers
---

## Rule
`start.sh` must inject Nix libs **before** finding Chrome binary. Order matters:
1. `freetype` (newest version via `sort -V | tail -1`) — fixes `FT_Get_Transform` undefined symbol in harfbuzz-10.2.0
2. GBM (`libgbm.so.1`) — try `mesa-libgbm` first (dev env), fallback to `mesa` package (deployment container uses `pkgs.mesa` from `replit.nix`)
3. `libxkbcommon`, `at-spi2-core`, `systemd-minimal-libs`

For GBM specifically: dev environment has `mesa-libgbm` as a separate Nix package; deployment container only has `mesa` (from `replit.nix`). The fallback checks `ls libgbm*` in the package lib dir before injecting.

## Chrome binary resolution
`start.sh` finds `chrome-headless-shell` via `find .puppeteer_cache -name chrome-headless-shell -type f`. If missing:
1. `rm -rf .puppeteer_cache/chrome-headless-shell` first — partial folder (folder exists, binary missing) blocks re-download
2. Then `npx puppeteer browsers install chrome-headless-shell`

`PUPPETEER_EXECUTABLE_PATH` is only set when the binary is actually found.

## Deployment vs dev fallback
- **Dev**: `chrome-headless-shell` folder exists but binary missing → falls back to regular `chrome` at `~/.cache/puppeteer/chrome/...` → freetype injection fixes harfbuzz symbol issue
- **Production**: `chrome-headless-shell` IS downloaded (build command), but `libgbm.so.1` not found unless mesa is injected

**Why:** Nix package names are stable but hash prefixes change with every Nix update. Dynamic search by name (`ls /nix/store | grep "^[hash]-mesa-libgbm-[0-9]"`) is required. The `mesa-libgbm` package is separate from `mesa` in nixpkgs.

**How to apply:** Any time start.sh is modified, preserve both `mesa-libgbm` and `mesa` fallback patterns. Use `sort -t'-' -k3 -V | tail -1` to get newest version, never `head -1`.
