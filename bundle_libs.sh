#!/usr/bin/env bash
# bundle_libs.sh — Copy Chrome's missing shared libs ke .lib/ untuk production runtime.
# Dijalankan saat build command. Libs ini tidak ada di Nix store runtime autoscale.
set -e

DEST="${1:-.lib}"
mkdir -p "$DEST"

echo "[bundle_libs] Mencari libgbm.so.1 di Nix store..."

MESA_PKG=""
for _p in $(ls /nix/store 2>/dev/null | grep -E '^[a-z0-9]+-mesa-[0-9]'); do
  if [ -f "/nix/store/${_p}/lib/libgbm.so.1" ]; then
    MESA_PKG="$_p"
    break
  fi
done

if [ -z "$MESA_PKG" ]; then
  echo "[bundle_libs] ERROR: libgbm.so.1 tidak ditemukan di Nix store saat build!"
  echo "[bundle_libs] Pastikan pkgs.mesa ada di replit.nix"
  exit 1
fi

MESA_LIB="/nix/store/${MESA_PKG}/lib"
echo "[bundle_libs] Mesa ditemukan: ${MESA_PKG}"

# ── Helper: copy semua symlink + actual file untuk sebuah .so ───────────────
copy_so() {
  local src_path="$1"
  local src_dir="$(dirname "$src_path")"
  local basename="$(basename "$src_path")"
  # Strip version suffix untuk dapat prefix: libfoo.so.1.2.3 → libfoo
  local prefix="$(echo "$basename" | sed 's/\.so.*//')"
  
  # Copy semua file yang cocok (symlink dan file asli)
  for f in "$src_dir"/${prefix}.so*; do
    [ -e "$f" ] || continue
    local dest_name="$(basename "$f")"
    if [ ! -e "${DEST}/${dest_name}" ]; then
      cp -P "$f" "${DEST}/"
      echo "[bundle_libs]   copied: $dest_name"
    fi
  done
}

# ── 1. Copy libgbm dan libglapi dari mesa ───────────────────────────────────
for so in "${MESA_LIB}"/libgbm.so* "${MESA_LIB}"/libglapi.so*; do
  [ -e "$so" ] || continue
  dest_name="$(basename "$so")"
  [ -e "${DEST}/${dest_name}" ] && continue
  cp -P "$so" "${DEST}/"
  echo "[bundle_libs]   copied: $dest_name"
done

# ── 2. Copy deps langsung dari ldd libgbm.so.1 (non-glibc) ──────────────────
while IFS= read -r dep_path; do
  [ -n "$dep_path" ] || continue
  copy_so "$dep_path"

  # Transitive deps (1 level) — semua masih hanya glibc, tapi cek dulu
  while IFS= read -r tdep; do
    [ -n "$tdep" ] || continue
    copy_so "$tdep"
  done < <(ldd "$dep_path" 2>/dev/null | grep '/nix/store' | grep -v 'glibc' | awk '{print $3}')

done < <(ldd "${MESA_LIB}/libgbm.so.1" 2>/dev/null | grep '/nix/store' | grep -v 'glibc' | awk '{print $3}')

# ── 3. Simpan path ke .nix_env (format: BASE_LD|GBM_LIB) ───────────────────
GBM_ABS_DIR="$(cd "$DEST" && pwd)"
printf '%s|%s' "${REPLIT_LD_LIBRARY_PATH:-}" "${GBM_ABS_DIR}" > .nix_env
echo "[bundle_libs] .nix_env saved → GBM=${GBM_ABS_DIR}"

echo "[bundle_libs] Bundled libs:"
ls -la "$DEST/"
echo "[bundle_libs] Done ✓"
