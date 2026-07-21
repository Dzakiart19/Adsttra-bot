#!/usr/bin/env bash
# Veneno Traffic Bot v2 — launcher
# Dynamic Nix library resolution: bekerja di local dev & deployment container
# tanpa hardcoded hash path yang cepat basi.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# === 1. Inject library Nix yang dibutuhkan Chrome ===
# Dilakukan SEBELUM mencari binary supaya LD_LIBRARY_PATH sudah benar.
if [ -d /nix/store ]; then
  _inject_nix_lib() {
    local pattern="$1"
    # Ambil versi TERBARU via sort -V (version sort)
    local pkg
    pkg=$(ls /nix/store 2>/dev/null \
          | grep "^[a-z0-9]*-${pattern}-[0-9]" \
          | grep -v "\.drv$" \
          | grep -v "\-dev$" \
          | sort -t'-' -k3 -V \
          | tail -1)
    if [ -n "$pkg" ] && [ -d "/nix/store/$pkg/lib" ]; then
      export LD_LIBRARY_PATH="/nix/store/$pkg/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
      echo "[start.sh] lib: /nix/store/$pkg/lib"
    fi
  }

  # FreeType — wajib sebelum harfbuzz agar FT_Get_Transform tersedia (harfbuzz>=10.x butuh ini)
  _inject_nix_lib "freetype"

  # GBM (libgbm.so.1) — coba mesa-libgbm dulu (dev env), fallback ke mesa (deployment)
  # Deployment container punya pkgs.mesa dari replit.nix; dev env punya mesa-libgbm secara terpisah
  _GBM_INJECTED=0
  _inject_nix_lib_gbm() {
    local pattern="$1"
    local pkg
    pkg=$(ls /nix/store 2>/dev/null \
          | grep "^[a-z0-9]*-${pattern}-[0-9]" \
          | grep -v "\.drv$" \
          | grep -v "\-dev$" \
          | grep -v "drivers\|spirv\|debug\|opencl\|osmesa\|teflon" \
          | sort -t'-' -k3 -V \
          | tail -1)
    if [ -n "$pkg" ] && [ -d "/nix/store/$pkg/lib" ] && ls /nix/store/"$pkg"/lib/libgbm* >/dev/null 2>&1; then
      export LD_LIBRARY_PATH="/nix/store/$pkg/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
      echo "[start.sh] lib (gbm): /nix/store/$pkg/lib"
      _GBM_INJECTED=1
    fi
  }

  _inject_nix_lib_gbm "mesa-libgbm"   # Paket terpisah (dev environment)
  if [ "$_GBM_INJECTED" -eq 0 ]; then
    _inject_nix_lib_gbm "mesa"         # Paket penuh dari replit.nix (deployment container)
  fi

  # Fallback libs tambahan
  _inject_nix_lib "libxkbcommon"
  _inject_nix_lib "at-spi2-core"
  _inject_nix_lib "systemd-minimal-libs"
fi

# === 2. Temukan Chrome binary (version-agnostic) ===
export PUPPETEER_CACHE_DIR="$SCRIPT_DIR/.puppeteer_cache"

CHROME_BIN=$(find "$SCRIPT_DIR/.puppeteer_cache" -name "chrome-headless-shell" -type f 2>/dev/null | head -1)

# Auto-download jika binary tidak ditemukan (first run atau cache terhapus)
if [ -z "$CHROME_BIN" ]; then
  echo "[start.sh] chrome-headless-shell tidak ditemukan — mengunduh sekarang..." >&2
  # Hapus folder yang tidak lengkap dulu (folder ada tapi binary tidak ada = download gagal sebelumnya)
  rm -rf "$SCRIPT_DIR/.puppeteer_cache/chrome-headless-shell"
  PUPPETEER_CACHE_DIR="$SCRIPT_DIR/.puppeteer_cache" npx puppeteer browsers install chrome-headless-shell 2>&1 || true
  CHROME_BIN=$(find "$SCRIPT_DIR/.puppeteer_cache" -name "chrome-headless-shell" -type f 2>/dev/null | head -1)
fi

if [ -n "$CHROME_BIN" ]; then
  export PUPPETEER_EXECUTABLE_PATH="$CHROME_BIN"
  echo "[start.sh] Chrome: $CHROME_BIN"
else
  echo "[start.sh] WARN: chrome-headless-shell tetap tidak ditemukan setelah download" >&2
fi

# === 3. Jalankan bot ===
exec node dist/main.js "$@"
