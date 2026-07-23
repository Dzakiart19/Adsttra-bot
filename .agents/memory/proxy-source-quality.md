---
name: Proxy source quality & validation order
description: Active proxy sources, pass rates, and the optimized 3-stage validation order (last tested 2026-07-23)
---

## Active sources (12 total)

Sources are ordered with Tier 1 country-specific endpoints FIRST so the streaming validator fills `tier1[]` faster and the bot can start with Tier 1 proxies immediately.

| Source | Pass rate | Notes |
|---|---|---|
| proxyscrape US 🇺🇸 | — | Tier 1, country-tagged |
| proxyscrape GB 🇬🇧 | — | Tier 1, country-tagged |
| proxyscrape CA 🇨🇦 | — | Tier 1, country-tagged |
| proxyscrape AU 🇦🇺 | — | Tier 1, country-tagged |
| proxyscrape FR 🇫🇷 | — | Tier 1, country-tagged |
| proxyscrape SE 🇸🇪 | — | Tier 1, country-tagged |
| proxyscrape NL 🇳🇱 | ~33% | Tier 1, country-tagged |
| proxyscrape DE 🇩🇪 | ~33% | Tier 1, country-tagged |
| proxyscrape JP 🇯🇵 | ~17% | Tier 1, very fast ~363ms avg |
| yakumo pre-checked | ~50% | Global, best pass rate |
| monosans/proxy-list HTTP | ~33% | Global, fast latency ~375ms avg |
| TheSpeedX/PROXY-List | ~17% | Global, high volume, some residential GB |

All 0% pass-rate sources removed (proxifly, clarketm, ShiftyTR, roosterkid, sunny9577, zevtyardt, ErcinDedeoglu, etc.).

## Validation order (3 stages, optimized for ip-api.com quota)

1. **HTTPS CONNECT** google.com:443 — cheap, no API; filters ~70% of proxies
2. **ip-api.com via proxy** — gets country + filters `hosting:true`/`vpn:true` at validation time
3. **Target-site probe** (HTTPS to target) — filters proxies that trigger "Anonymous Proxy detected."

**Why this order:** ip-api.com free tier = 45 req/min from server IP. Old order called ip-api.com first (step 1) for all 2800+ proxies. New order: only proxies that pass HTTPS CONNECT reach ip-api.com → ~70% savings.

## Runtime changes

- `ReputationService.checkIP()` removed from `main.ts` runtime — proxy already pre-filtered at validation
- ip-api.com is now ONLY called via proxy during validation (not directly from server IP)
- Runtime blacklist (`ProxyService.blacklistProxy()`) for proxies blocked by target site during session
