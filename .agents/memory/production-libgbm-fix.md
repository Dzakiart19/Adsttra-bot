---
name: Production libgbm fix
description: Root cause and fix for "libgbm.so.1: cannot open shared object file" / Chrome exit 127 in autoscale production. Fixed 2026-07-23.
---

## Symptom
Production (autoscale): `Failed to launch the browser process: Code: 127`
```
chrome-headless-shell: error while loading shared libraries: libgbm.so.1: cannot open shared object file: No such file or directory
```
Dev works fine. Dashboard shows `LD_LIBRARY_PATH set (freetype=freetype-2.13.3, gbm=none)`.

## Root cause (confirmed via production logs)
In production autoscale runtime, `REPLIT_LD_LIBRARY_PATH` IS set — but does NOT include mesa.
Freetype and other libs are present, but mesa (which contains `libgbm.so.1`) is absent.

This is a Replit autoscale behavior: `replit.nix` with `pkgs.mesa` installs mesa into the Nix
store, but the autoscale runtime container exports a different (smaller) `REPLIT_LD_LIBRARY_PATH`
that omits mesa. The dev environment includes mesa in `REPLIT_LD_LIBRARY_PATH`; production does not.

Old approaches that failed:
- Python script reading env.json → env.json may not exist in production build containers
- `printf REPLIT_LD_LIBRARY_PATH > .nix_env` → .nix_env captures LD without mesa at build time if build container also omits mesa
- `ls /nix/store | grep mesa | tail -1` → picks wrong package (e.g. mesa-drivers, not main mesa)

## Fix (current, 2026-07-23)
In `start.sh` Step 2c: iterate all mesa packages in Nix store, check each for `libgbm.so.1`:
```bash
for _mesa_pkg in $(ls /nix/store 2>/dev/null | grep -E '^[a-z0-9]+-mesa-[0-9]'); do
  if [ -f "/nix/store/${_mesa_pkg}/lib/libgbm.so.1" ]; then
    GBM_LIB="/nix/store/${_mesa_pkg}/lib"
    break
  fi
done
```
`ls /nix/store` = top-level only (fast). Multiple mesa versions exist; iterate to find correct one.
Verified working: finds `mesa-22.3.7` with `libgbm.so.1` present → Chrome launches successfully.

## Key facts
- Mesa IS in Nix store in production (replit.nix installs it) — just not in REPLIT_LD_LIBRARY_PATH
- Multiple mesa packages coexist in /nix/store; the one with libgbm.so.1 may not be the latest
- `ls /nix/store | grep -E '^[a-z0-9]+-mesa-[0-9]'` is fast (top-level listing, no recursion)
- `find /nix/store -name "libgbm.so.1"` is SLOW — times out — never use it

## How to apply
If Chrome fails with Code 127 / libgbm missing in production:
1. Verify start.sh Step 2c iterates all mesa packages (not head/tail -1)
2. Republish to deploy the fixed start.sh
