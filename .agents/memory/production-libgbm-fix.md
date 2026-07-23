---
name: Production libgbm fix
description: Root cause and fix for "libgbm.so.1: cannot open shared object file" / Chrome exit 127 in autoscale production. FULLY CONFIRMED 2026-07-23.
---

## Symptom
Production (autoscale): `Failed to launch the browser process: Code: 127`
```
chrome-headless-shell: error while loading shared libraries: libgbm.so.1: cannot open shared object file: No such file or directory
```
Dev works fine.

## Root cause (confirmed via production logs)
In production autoscale **runtime**, the Nix store does NOT have mesa packages at all.
`REPLIT_LD_LIBRARY_PATH` is set but without mesa, AND `/nix/store` in the runtime container
has no `mesa-*` entries. Confirmed by: start.sh Step 2d (Nix store search) printing
`WARNING: libgbm.so.1 tidak ditemukan` in the deployment logs.

Build container (where build command runs) DOES have mesa in the Nix store.
Runtime container (where app actually runs) does NOT have mesa.

## Fix (current, 2026-07-23 — WORKING)
### bundle_libs.sh
Runs during build. Finds libgbm.so.1 in build container's Nix store → copies it
and all non-glibc transitive deps to `.lib/` in the workspace:
- libgbm.so.1 (+ .so, .so.1.0.0) ← the missing lib
- libglapi.so.0
- libdrm.so.2
- libwayland-server.so.0
- libffi.so.8
- libexpat.so.1

Build command: `... && bash bundle_libs.sh`
This writes `.lib/` with 18 files (libs + symlinks), and updates `.nix_env` with the path.

### start.sh Step 2a (highest priority)
```bash
if [ -f "${SCRIPT_DIR}/.lib/libgbm.so.1" ]; then
  GBM_LIB="${SCRIPT_DIR}/.lib"
fi
```
`.lib/` is in the workspace → persists from build to runtime → always available.

### Full fallback chain
2a → .lib/ (workspace bundle, PRIMARY for production)
2b → .nix_env GBM part (also points to .lib/ after bundle_libs.sh)
2c → mesa already in REPLIT_LD_LIBRARY_PATH (dev/local normal case)
2d → Nix store search (ls /nix/store, fallback, won't work in production)

## Transitive deps of libgbm.so.1
- libdrm.so.2 → only glibc (always available)
- libwayland-server.so.0 → libffi.so.8 + glibc
- libexpat.so.1 → glibc only
- libffi.so.8 → glibc only
All non-glibc deps are shallow (1 level) — no deep recursion needed.

## How to apply
If Chrome fails with Code 127 / libgbm missing in production:
1. Verify `bundle_libs.sh` exists and build command ends with `&& bash bundle_libs.sh`
2. Verify `start.sh` Step 2a checks `${SCRIPT_DIR}/.lib/libgbm.so.1`
3. Republish — build container will copy mesa libs into `.lib/`
4. `.lib/` must NOT be in .gitignore (it's a build artifact that needs to persist)
