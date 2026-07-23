---
name: Fresh-clone portability
description: Rules for making the project work on a fresh clone+publish without any manual edits.
---

## What the build command handles (`.replit` `[deployment] build`)
- `npm install` — installs node_modules
- `npm run build` — compiles TypeScript → dist/
- Removes proxy_cache.json, uptime_stats.json (regenerated at runtime)
- `PUPPETEER_CACHE_DIR=.puppeteer_cache npx puppeteer browsers install chrome-headless-shell` → downloads Chrome binary
- Python script → generates `.nix_env` with correct Nix paths for the deployment environment

## What start.sh handles (self-healing for dev + deploy)
- Auto-builds if `dist/main.js` missing (fresh clone without a prior build step)
- Reads `env.json` for LD_LIBRARY_PATH + mesa-libgbm path (always current for current env)
- Falls back to `.nix_env` if env.json missing or GBM not found
- Finds Chrome binary in `.puppeteer_cache/` or `~/.cache/puppeteer/`
- Auto-installs chrome-headless-shell if no Chrome binary found anywhere

## .gitignore rules
- `dist/` — gitignored; build generates it ✓
- `.puppeteer_cache/chrome-headless-shell/` — gitignored; build downloads it ✓
- `.nix_env` — gitignored; build generates it ✓
- `proxy_cache.json`, `uptime_stats.json` — gitignored; runtime generates them ✓

## npm postinstall
Set to `echo 'Skipping browser download'` — intentionally prevents puppeteer from downloading
Chrome during `npm install` (Chrome is downloaded separately by the build command into `.puppeteer_cache/`).

## Why
Hardcoded Nix paths and Chrome binary paths only work in the specific environment where they
were generated. A fresh Replit project gets different Nix store hashes. The dynamic start.sh
pattern makes the bot self-sufficient regardless of where it runs.
