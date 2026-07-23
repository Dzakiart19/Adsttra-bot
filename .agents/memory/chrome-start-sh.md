---
name: Chrome library & start.sh
description: How start.sh resolves Nix library paths and Chrome binary without hardcoded hashes.
---

## Rule
`start.sh` MUST be fully dynamic — never hardcode `/nix/store/HASH-...` paths.
Hashes change with every Nix package update; a hardcoded hash from one environment breaks all other environments.

## LD_LIBRARY_PATH resolution order
1. **env.json primary** — `.cache/replit/nix/env.json` is always fresh for the current Nix environment.
   - `REPLIT_LD_LIBRARY_PATH` → all standard libs
   - regex `r'/nix/store/[a-z0-9]+-mesa-libgbm[^":/\s]*'` anywhere in the file → GBM path (append `/lib` manually)
   - Note: mesa-libgbm is NOT in `REPLIT_LD_LIBRARY_PATH`; must search the whole JSON
2. **`.nix_env` fallback (full)** — if env.json missing, use `.nix_env` (format: `LD_PATHS|GBM_PATH`)
3. **`.nix_env` GBM fallback** — if env.json has LD but not GBM, still check `.nix_env` for GBM part

GBM must be prepended to LD_LIBRARY_PATH (before standard mesa) to take priority.

## Chrome binary resolution order
1. `.puppeteer_cache/` local dir — installed by deployment build command
2. `/home/runner/.cache/puppeteer/` — puppeteer default download location
3. **Auto-install** — if nothing found, run `PUPPETEER_CACHE_DIR=.puppeteer_cache npx puppeteer browsers install chrome-headless-shell`

**Never** `find /nix/store` — causes timeout. Only search small local dirs.

## .nix_env
- Gitignored (environment-specific; build command regenerates it correctly per environment)
- Build command (`.replit`) generates it via Python regex on env.json
- start.sh uses it as fallback; env.json is preferred because it's always current

## Why
Nix store hashes change when packages are updated. Hardcoded paths from one session break
any other environment (fresh clone, re-publish, Nix update). The dynamic approach works
because env.json is always written by Replit with current hashes for whatever environment is running.
