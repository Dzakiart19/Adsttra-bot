---
name: start.sh FreeType fix
description: harfbuzz 10.2.0 requires FreeType ≥2.11; start.sh must use REPLIT_LD_LIBRARY_PATH (dynamic) not hardcoded freetype-2.10.4 path.
---

## Rule
`start.sh` MUST use `$REPLIT_LD_LIBRARY_PATH` as base — never hardcode a specific freetype version path.

## Why
`harfbuzz-10.2.0` requires `FT_Get_Transform` which was added in FreeType 2.11.
Old hardcoded path `freetype-2.10.4` causes:
```
symbol lookup error: libharfbuzz.so.0: undefined symbol: FT_Get_Transform
```

`REPLIT_LD_LIBRARY_PATH` (env var set by Nix) always contains the correct current freetype version
(e.g. `yw429hvy80x2hg00lsfdfhkkib7gz54g-freetype-2.13.3/lib` as of 2026-07-23).

## Confirmed working pattern (2026-07-23)
```bash
BASE_LD="${REPLIT_LD_LIBRARY_PATH:-}"
# Prepend GBM from env.json regex, then:
export LD_LIBRARY_PATH="${GBM_LIB}:${BASE_LD}${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
```

This gives:
- `freetype=freetype-2.13.3` ✓
- `gbm=mesa-libgbm-25.0.1` ✓
- Chrome launches cleanly

## How to apply
Any time start.sh is regenerated (install.sh, deployment, manual), always use `$REPLIT_LD_LIBRARY_PATH`
as the base LD path, never reconstruct the path list by hand from env.json entries.
