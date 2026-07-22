#!/usr/bin/env bash
# Veneno Traffic Bot — self-healing startup
#
# Zero-config: works on any Replit environment after fresh clone+publish.
# Tidak ada hardcoded /nix/store path — semua di-resolve dinamis.
#
# Urutan:
#   1. Auto-build TypeScript jika dist/main.js belum ada
#   2. Resolve LD_LIBRARY_PATH dari env.json (selalu current) → fallback .nix_env
#   3. Temukan Chrome binary, auto-install jika belum ada
#   4. Launch node dist/main.js

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ── 1. Auto-build jika dist/main.js belum ada (fresh clone) ───────────────────
if [ ! -f "dist/main.js" ]; then
  echo "[start.sh] Compiling TypeScript..."
  npm run build
fi

# ── 2. Resolve LD_LIBRARY_PATH ────────────────────────────────────────────────
# Priority A: env.json — selalu fresh untuk Nix environment ini
# Priority B: .nix_env  — di-generate oleh deployment build command

_LD=""
_GBM=""

if [ -f ".cache/replit/nix/env.json" ]; then
  _LD=$(python3 -c "
import re
try:
  c = open('.cache/replit/nix/env.json').read()
  m = re.search(r'\"REPLIT_LD_LIBRARY_PATH\":\"([^\"]+)\"', c)
  if m:
    print(m.group(1).split('|')[0], end='')
except Exception:
  pass
")
  # Cari mesa-libgbm di mana saja dalam env.json (tidak hanya di LD path)
  _GBM=$(python3 -c "
import re
try:
  c = open('.cache/replit/nix/env.json').read()
  gbm = sorted(set(re.findall(r'/nix/store/[a-z0-9]+-mesa-libgbm[^\":/\s]*', c)))
  print(gbm[-1] + '/lib' if gbm else '', end='')
except Exception:
  pass
")
fi

# Fallback lengkap ke .nix_env jika env.json tidak ada
if [ -z "$_LD" ] && [ -f ".nix_env" ]; then
  _RAW=$(cat .nix_env)
  if echo "$_RAW" | grep -q '|'; then
    _LD="${_RAW%|*}"
    _GBM="${_RAW##*|}"
  else
    _LD="$_RAW"
  fi
fi

# Fallback GBM saja: env.json punya LD tapi tidak punya GBM → ambil dari .nix_env
if [ -z "$_GBM" ] && [ -f ".nix_env" ]; then
  _RAW=$(cat .nix_env)
  if echo "$_RAW" | grep -q '|'; then
    _GBM="${_RAW##*|}"
  fi
fi

# Export: GBM selalu di depan (override mesa reguler)
if [ -n "$_GBM" ] && [ -n "$_LD" ]; then
  export LD_LIBRARY_PATH="${_GBM}:${_LD}${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
elif [ -n "$_LD" ]; then
  export LD_LIBRARY_PATH="${_LD}${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
elif [ -n "$_GBM" ]; then
  export LD_LIBRARY_PATH="${_GBM}${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
fi

# ── 3. Temukan Chrome binary ──────────────────────────────────────────────────
# JANGAN find /nix/store — terlalu lambat (timeout).

_CHROME=""

# a) .puppeteer_cache/ — diisi oleh build command atau auto-install di bawah
if [ -d ".puppeteer_cache" ]; then
  _CHROME=$(find ".puppeteer_cache" -type f \( -name "chrome-headless-shell" -o -name "chrome" \) \
            2>/dev/null | grep -v '\.json$' | head -1)
fi

# b) ~/.cache/puppeteer — lokasi default puppeteer
if [ -z "$_CHROME" ] && [ -d "/home/runner/.cache/puppeteer" ]; then
  _CHROME=$(find "/home/runner/.cache/puppeteer" -maxdepth 6 -type f \
            \( -name "chrome-headless-shell" -o -name "chrome" \) \
            2>/dev/null | grep -v '\.json$' | head -1)
fi

# c) Auto-install jika Chrome sama sekali tidak ditemukan (fresh clone / dev)
if [ -z "$_CHROME" ]; then
  echo "[start.sh] Chrome tidak ditemukan — install chrome-headless-shell (~150MB, sekali saja)..."
  PUPPETEER_CACHE_DIR=.puppeteer_cache npx puppeteer browsers install chrome-headless-shell
  _CHROME=$(find ".puppeteer_cache" -type f -name "chrome-headless-shell" \
            2>/dev/null | grep -v '\.json$' | head -1)
fi

if [ -n "$_CHROME" ]; then
  export PUPPETEER_EXECUTABLE_PATH="$_CHROME"
fi

# ── 4. Launch ─────────────────────────────────────────────────────────────────
exec node dist/main.js "$@"
