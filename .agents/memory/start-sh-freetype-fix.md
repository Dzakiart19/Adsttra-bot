---
name: start.sh FreeType fix
description: harfbuzz 10.2.0 requires FreeType ≥2.11; start.sh must use REPLIT_LD_LIBRARY_PATH (dynamic) not hardcoded freetype path. Also covers mesa/GBM status as of 2026-07-23.
---

## Rule
`start.sh` MUST use `$REPLIT_LD_LIBRARY_PATH` as base — never hardcode a specific freetype or mesa version path.

## Why (FreeType)
`harfbuzz-10.2.0` requires `FT_Get_Transform` which was added in FreeType 2.11.
Old hardcoded path `freetype-2.10.4` causes:
```
symbol lookup error: libharfbuzz.so.0: undefined symbol: FT_Get_Transform
```
`REPLIT_LD_LIBRARY_PATH` always contains the correct current freetype version
(e.g. `yw429hvy80x2hg00lsfdfhkkib7gz54g-freetype-2.13.3/lib` as of 2026-07-23).

## Current library status (Nix stable-25_05, 2026-07-23)
- `freetype-2.13.3` — in REPLIT_LD_LIBRARY_PATH ✓
- `mesa-25.0.7` — in REPLIT_LD_LIBRARY_PATH ✓ (includes libgbm.so.1 — no separate mesa-libgbm package)
- GBM search regex `mesa-libgbm` will return EMPTY — this is expected and OK

## Confirmed working pattern
```bash
BASE_LD="${REPLIT_LD_LIBRARY_PATH:-}"
# Fallback: read .nix_env if REPLIT_LD_LIBRARY_PATH not available (autoscale runtime)
if [ -z "$BASE_LD" ] && [ -f ".nix_env" ]; then
  IFS='|' read -r _nix_ld _nix_gbm < ".nix_env"
  BASE_LD="${_nix_ld:-}"
fi
# GBM_LIB from env.json regex (may be empty on stable-25_05 — OK, mesa already in BASE_LD)
export LD_LIBRARY_PATH="${GBM_LIB:+$GBM_LIB:}${BASE_LD}${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
```

## How to apply
Any time start.sh is regenerated or modified:
1. Always use `$REPLIT_LD_LIBRARY_PATH` as the base LD path
2. Never reconstruct the path list by hand from env.json entries
3. Never hardcode a specific hash or version (freetype-2.13.3, mesa-25.0.7, etc.)
4. GBM_LIB prepend is harmless even if empty — the `${GBM_LIB:+...}` guard handles it
