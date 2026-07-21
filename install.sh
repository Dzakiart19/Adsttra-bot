#!/usr/bin/env bash
# =============================================================================
#  Veneno Traffic Bot v2 — One-Shot Installer
#  Jalankan sekali: bash install.sh
#  Mendukung: Replit (NixOS) | Ubuntu 20.04+ | Debian 11+
# =============================================================================

set -euo pipefail

# ── Warna & helpers ───────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()    { echo -e "${CYAN}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }
step()    { echo -e "\n${CYAN}══════════════════════════════════════════${NC}"; echo -e "${CYAN}  $*${NC}"; echo -e "${CYAN}══════════════════════════════════════════${NC}"; }

# ── Deteksi lingkungan ────────────────────────────────────────────────────────
detect_env() {
  if [ -f /etc/NIXOS ] || [ -n "${REPL_ID:-}" ] || [ -d /nix/store ]; then
    echo "replit"
  elif grep -qi "ubuntu\|debian" /etc/os-release 2>/dev/null; then
    echo "ubuntu"
  else
    echo "unknown"
  fi
}

ENV=$(detect_env)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo ""
echo -e "${GREEN}"
echo "  ██╗   ██╗███████╗███╗   ██╗███████╗███╗   ██╗ ██████╗"
echo "  ██║   ██║██╔════╝████╗  ██║██╔════╝████╗  ██║██╔═══██╗"
echo "  ██║   ██║█████╗  ██╔██╗ ██║█████╗  ██╔██╗ ██║██║   ██║"
echo "  ╚██╗ ██╔╝██╔══╝  ██║╚██╗██║██╔══╝  ██║╚██╗██║██║   ██║"
echo "   ╚████╔╝ ███████╗██║ ╚████║███████╗██║ ╚████║╚██████╔╝"
echo "    ╚═══╝  ╚══════╝╚═╝  ╚═══╝╚══════╝╚═╝  ╚═══╝ ╚═════╝"
echo -e "${NC}"
echo -e "  ${CYAN}Traffic Bot v2 — Installer${NC}"
echo -e "  Lingkungan terdeteksi: ${YELLOW}${ENV}${NC}"
echo ""

# =============================================================================
# STEP 1 — System dependencies
# =============================================================================
step "STEP 1/5 — System Dependencies"

if [ "$ENV" = "replit" ]; then
  info "Replit/NixOS — dependencies dikelola via replit.nix (sudah terpasang)"
  info "Verifikasi Nix packages kritis..."

  NIX_MISSING=()
  for pkg in mesa-libgbm systemd-minimal-libs libxkbcommon; do
    if ! ls /nix/store/*-${pkg}* &>/dev/null 2>&1; then
      NIX_MISSING+=("$pkg")
    fi
  done

  if [ ${#NIX_MISSING[@]} -gt 0 ]; then
    warn "Package Nix berikut belum ditemukan di store: ${NIX_MISSING[*]}"
    warn "Pastikan replit.nix sudah di-save dan Replit telah me-reload environment."
  else
    success "Semua Nix packages kritis tersedia"
  fi

elif [ "$ENV" = "ubuntu" ]; then
  info "Ubuntu/Debian — menginstall Chrome dependencies via apt..."
  sudo apt-get update -qq

  CHROME_DEPS=(
    ca-certificates fonts-liberation libasound2 libatk-bridge2.0-0 libatk1.0-0
    libc6 libcairo2 libcups2 libdbus-1-3 libexpat1 libfontconfig1 libgbm1
    libgcc1 libglib2.0-0 libgtk-3-0 libnspr4 libnss3 libpango-1.0-0
    libpangocairo-1.0-0 libstdc++6 libx11-6 libx11-xcb1 libxcb1 libxcomposite1
    libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 libxrandr2 libxrender1
    libxss1 libxtst6 lsb-release wget xdg-utils libudev1 libxkbcommon0
  )

  sudo apt-get install -y --no-install-recommends "${CHROME_DEPS[@]}" 2>&1 | \
    grep -E "^(Setting up|Unpacking|Get:|Err:)" || true
  success "System dependencies terpasang"

else
  warn "OS tidak dikenali — skip instalasi system packages"
  warn "Pastikan Chrome dependencies terpasang manual (lihat README)"
fi

# =============================================================================
# STEP 2 — Node.js & npm check
# =============================================================================
step "STEP 2/5 — Node.js Environment"

if ! command -v node &>/dev/null; then
  error "Node.js tidak ditemukan! Install Node.js 18+ terlebih dahulu."
fi
if ! command -v npm &>/dev/null; then
  error "npm tidak ditemukan! Install npm terlebih dahulu."
fi

NODE_VER=$(node --version)
NPM_VER=$(npm --version)
success "Node.js ${NODE_VER} | npm v${NPM_VER}"

# =============================================================================
# STEP 3 — Node.js packages
# =============================================================================
step "STEP 3/5 — Node.js Packages"

cd "$SCRIPT_DIR"

info "Menginstall production dependencies (tanpa devDependencies)..."
npm install --omit=dev --ignore-scripts 2>&1 | tail -5

info "Menginstall TypeScript compiler..."
npm install --save-dev typescript@5 @types/node 2>&1 | tail -3

info "Menginstall ts-node (dibutuhkan untuk download script)..."
npm install --save-dev ts-node 2>&1 | tail -3

success "Node.js packages selesai"

# =============================================================================
# STEP 4 — Chrome / Puppeteer browser
# =============================================================================
step "STEP 4/5 — Chrome Browser (Puppeteer)"

CHROME_CACHE="${HOME}/.cache/puppeteer"
CHROME_FOUND=$(ls -d "${CHROME_CACHE}/chrome/linux-"* 2>/dev/null | head -1 || echo "")

if [ -n "$CHROME_FOUND" ]; then
  CHROME_VER=$(basename "$CHROME_FOUND")
  CHROME_BIN="${CHROME_FOUND}/chrome-linux64/chrome"
  if [ -x "$CHROME_BIN" ]; then
    success "Chrome sudah ada: ${CHROME_VER}"
    skip_download=true
  else
    warn "Folder Chrome ada tapi binary tidak ditemukan, re-download..."
    skip_download=false
  fi
else
  skip_download=false
fi

if [ "$skip_download" = "false" ]; then
  info "Mendownload Chrome untuk Puppeteer (bisa beberapa menit)..."
  node -e "
    const puppeteer = require('puppeteer');
    const { downloadBrowser } = require('puppeteer/internal/node/install.js');
    downloadBrowser().then(() => console.log('Chrome berhasil didownload')).catch(e => {
      // Coba cara lain
      const { execSync } = require('child_process');
      execSync('node node_modules/puppeteer/lib/cjs/puppeteer/node/install.js', { stdio: 'inherit' });
    });
  " 2>/dev/null || \
  PUPPETEER_CACHE_DIR="${CHROME_CACHE}" node -e "
    const { execSync } = require('child_process');
    try {
      execSync('npx puppeteer browsers install chrome', { stdio: 'inherit' });
    } catch(e) {
      execSync('node node_modules/.bin/puppeteer browsers install chrome', { stdio: 'inherit' });
    }
  " 2>&1 | tail -10

  # Verifikasi ulang
  CHROME_FOUND=$(ls -d "${CHROME_CACHE}/chrome/linux-"* 2>/dev/null | head -1 || echo "")
  if [ -n "$CHROME_FOUND" ] && [ -x "${CHROME_FOUND}/chrome-linux64/chrome" ]; then
    success "Chrome berhasil didownload: $(basename "$CHROME_FOUND")"
  else
    error "Download Chrome gagal! Jalankan manual: npx puppeteer browsers install chrome"
  fi
fi

# =============================================================================
# STEP 5 — Build TypeScript
# =============================================================================
step "STEP 5/5 — Build TypeScript"

info "Compiling TypeScript → dist/ ..."
node_modules/.bin/tsc 2>&1
success "Build selesai — output di dist/"

# =============================================================================
# Buat start.sh wrapper dengan LD_LIBRARY_PATH yang benar
# =============================================================================
step "Membuat start.sh launcher"

# Auto-detect Nix lib paths
build_ld_library_path() {
  local paths=()

  if [ "$ENV" = "replit" ]; then
    # Cari semua lib dir yang relevan dari /nix/store
    local packages=(
      "mesa-libgbm"
      "systemd-minimal-libs"
      "libxkbcommon"
      "at-spi2-core"
      "cups-"
      "nspr-"
      "nss-"
      "alsa-lib"
      "cairo-"
      "gtk+-3"
      "expat-"
      "dbus-"
      "freetype-"
      "libX11-"
      "libxcb-"
      "libXcomposite-"
      "libXcursor-"
      "libXdamage-"
      "libXext-"
      "libXfixes-"
      "libXi-"
      "libXrandr-"
      "libXrender-"
      "libXScrnSaver-"
      "libXtst-"
    )

    for pkg in "${packages[@]}"; do
      local found
      found=$(ls -d /nix/store/*-${pkg}*/lib 2>/dev/null | head -1 || echo "")
      if [ -n "$found" ] && [ -d "$found" ]; then
        paths+=("$found")
      fi
    done
  fi

  IFS=':' ; echo "${paths[*]}" ; unset IFS
}

LD_PATH=$(build_ld_library_path)

cat > "${SCRIPT_DIR}/start.sh" << STARTEOF
#!/usr/bin/env bash
# Auto-generated oleh install.sh
# Jalankan bot dengan library path yang benar

SCRIPT_DIR="\$(cd "\$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
cd "\$SCRIPT_DIR"

export LD_LIBRARY_PATH="${LD_PATH}\${LD_LIBRARY_PATH:+:\$LD_LIBRARY_PATH}"

exec node dist/main.js "\$@"
STARTEOF

chmod +x "${SCRIPT_DIR}/start.sh"
success "start.sh dibuat (gunakan ini untuk menjalankan bot)"

# =============================================================================
# RINGKASAN
# =============================================================================
echo ""
echo -e "${GREEN}╔═══════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║          INSTALASI SELESAI — Veneno Traffic Bot v2         ║${NC}"
echo -e "${GREEN}╚═══════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${CYAN}Chrome:${NC}     $(ls -d "${HOME}/.cache/puppeteer/chrome/linux-"* 2>/dev/null | head -1 | xargs basename 2>/dev/null || echo 'not found')"
echo -e "  ${CYAN}Node.js:${NC}    $(node --version)"
echo -e "  ${CYAN}Build:${NC}      dist/main.js ✓"
echo -e "  ${CYAN}Launcher:${NC}   ./start.sh"
echo ""
echo -e "  ${YELLOW}Cara menjalankan bot:${NC}"
echo -e "  ${GREEN}  bash start.sh${NC}"
echo ""
echo -e "  ${YELLOW}Konfigurasi via .env atau environment variables:${NC}"
echo -e "  ${CYAN}  DEFAULT_URL${NC}               = URL target"
echo -e "  ${CYAN}  MAX_SESSIONS${NC}              = jumlah sesi (default: 1)"
echo -e "  ${CYAN}  SESSION_TIME${NC}              = menit per sesi atau 'random'"
echo -e "  ${CYAN}  USE_FREE_PROXIES${NC}          = true/false (auto-fetch proxy gratis)"
echo -e "  ${CYAN}  PROXY_VALIDATE_CONCURRENCY${NC} = jumlah worker validasi proxy (default: 40)"
echo -e "  ${CYAN}  HUMAN_BEHAVIOR${NC}            = true/false"
echo -e "  ${CYAN}  HEADLESS${NC}                  = true/false"
echo -e "  ${CYAN}  ORGANIC_SEARCH${NC}            = true/false"
echo -e "  ${CYAN}  PROXY_URL${NC}                 = host proxy manual (opsional)"
echo ""
echo -e "  ${YELLOW}Contoh dengan .env:${NC}"
echo -e "  ${GREEN}  cat > .env << EOF"
echo -e "  DEFAULT_URL=https://contoh.com/"
echo -e "  MAX_SESSIONS=3"
echo -e "  SESSION_TIME=random"
echo -e "  USE_FREE_PROXIES=true"
echo -e "  HUMAN_BEHAVIOR=true"
echo -e "  EOF"
echo -e "  bash start.sh${NC}"
echo ""
