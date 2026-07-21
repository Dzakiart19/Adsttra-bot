---
name: Target-site proxy block detection
description: After navigating to the target URL, bot must check if the page is a proxy-block page (e.g. "Anonymous Proxy detected.") and throw ERR_PROXY to trigger retry.
---

## The Rule

In `TrafficOrchestrator.run()`, immediately after all navigation paths converge (after organic search OR referrer spoofing + `engine.navigate(config.url)`), and BEFORE the ad warm-up block, insert a body-text check:

1. `engine.evaluate()` to get `document.body.innerText` (first 600 chars)
2. If body is short (<300 chars) AND matches a block pattern → throw `Error('ERR_PROXY: ...')`
3. The `ERR_PROXY` prefix is caught by `isProxyErr` check in `main.ts` retry loop

**Block patterns checked:**
- `anonymous proxy detected`
- `proxy detected`
- `vpn detected`
- `your ip.*blocked` / `ip.*blocked`
- `access denied`
- `you have been blocked`
- `suspicious activity`
- `automated.*traffic`
- `bot.*detected`

**Why the `bodyText.length < 300` guard:**
Real pages almost always have >300 chars of body text. Proxy-block pages are typically very short (e.g. exactly `"Anonymous Proxy detected."` = 25 chars). This prevents false positives on real pages that happen to contain those words in a longer body.

**Why:**
effectivecpmnetwork.com and other ad networks detect proxy IPs at HTTP level and serve a plain-text block page instead of the ad content. Without this check, the bot silently sits on the block page for the full dwell time (30-45s) without any impression being counted.

**How to apply:**
- Block is in `src/application/traffic/TrafficOrchestrator.ts`, between the navigation block (line ~146) and the ad warm-up block (formerly line ~148)
- The catch inside the check must re-throw `ERR_PROXY` errors but swallow evaluate errors (page crash, etc.)
- When ip-api.com is rate-limited and returns `null`, the proxy passes the reputation check but may be caught here instead — this is correct behavior (graceful degradation)
