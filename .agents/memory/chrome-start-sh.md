---
name: Chrome library & start.sh
description: How start.sh resolves Nix library paths and Chrome binary without hardcoded hashes. Updated 2026-07-23 after production libgbm fix.
---

## Rule
`start.sh` MUST be fully dynamic — never hardcode `/nix/store/HASH-...` paths.
Hashes change with every Nix package update; a hardcoded hash from one environment breaks all other environments.

## Critical: mesa-libgbm is merged into mesa (Nix stable-25_05)
As of 2026-07-23 (Nix channel `stable-25_05`), there is NO separate `mesa-libgbm` package.
`libgbm.so.1` lives inside one of the versioned mesa packages in `/nix/store` (e.g. `mesa-22.3.7` or `mesa-25.0.7`).

**Important:** `REPLIT_LD_LIBRARY_PATH` in **production autoscale runtime** does NOT include mesa — even though `replit.nix` specifies `pkgs.mesa`. Mesa IS in the Nix store but not exported to that env var at runtime.

## GBM resolution — 3 steps (in order)

### 2a) Mesa already in REPLIT_LD_LIBRARY_PATH (dev/local)
```bash
MESA_IN_BASE=$(echo "${BASE_LD}" | tr ':' '\n' | grep '/mesa-' | head -1)
# If found and libgbm.so.1 exists there → no extra action needed
```

### 2b) Mesa path saved in .nix_env (GBM part)
Build command saves mesa path to `.nix_env` (format: `LD_PATHS|GBM_PATH`).
If GBM_PATH is valid and has libgbm.so.1 → use it.

### 2c) Fast Nix store search (REQUIRED for production autoscale)
```bash
for _mesa_pkg in $(ls /nix/store 2>/dev/null | grep -E '^[a-z0-9]+-mesa-[0-9]'); do
  if [ -f "/nix/store/${_mesa_pkg}/lib/libgbm.so.1" ]; then
    GBM_LIB="/nix/store/${_mesa_pkg}/lib"
    break
  fi
done
```
`ls /nix/store` = top-level listing only (NOT recursive) — fast, does not timeout.
There are multiple mesa packages in /nix/store; iterate until finding one with libgbm.so.1.
**DO NOT use** `find /nix/store -name "libgbm.so.1"` — full recursive search, times out.
**DO NOT use** `| tail -1` or `| head -1` without verifying libgbm.so.1 — picks wrong mesa (e.g. mesa-drivers).

## LD_LIBRARY_PATH resolution order (full)
1. `REPLIT_LD_LIBRARY_PATH` env var → BASE_LD
2. `.nix_env` fallback (LD part) if BASE_LD empty
3. GBM_LIB set via 2a/2b/2c above, prepended to BASE_LD

## Chrome binary resolution order
1. `.puppeteer_cache/` local dir — installed by deployment build command
2. `/home/runner/.cache/puppeteer/` — puppeteer default download location
3. System chromium paths
4. Auto-install via `PUPPETEER_CACHE_DIR=.puppeteer_cache npx puppeteer browsers install chrome-headless-shell`

`.puppeteerrc.cjs` directs puppeteer's own cache lookup to `.puppeteer_cache/` (project-local, persists in deployment).
**Never** `find /nix/store` for Chrome — scan only small local dirs.

## .nix_env — format and generation
Format: `BASE_LD_PATHS|GBM_LIB_PATH`
Build command:
```bash
MESA_PKG=$(for p in $(ls /nix/store | grep -E '^[a-z0-9]+-mesa-[0-9]'); do
  [ -f "/nix/store/$p/lib/libgbm.so.1" ] && echo "$p" && break; done)
printf '%s|%s' "${REPLIT_LD_LIBRARY_PATH}" "/nix/store/${MESA_PKG}/lib" > .nix_env
```
Gitignored; regenerated on every publish/build.
