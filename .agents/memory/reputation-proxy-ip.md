---
name: ReputationService proxy IP check
description: ReputationService must query the proxy host IP directly, not the bare ip-api.com endpoint
---

**Rule:** Extract host from `proxyServer` ("host:port") and call `http://ip-api.com/json/{host}?fields=...`. Without the IP path, ip-api.com returns the calling server's own IP — useless for proxy reputation.

**Why:** Silent logic bug — the service always reported the Replit server's IP as clean, giving false confidence about proxy quality.

**How to apply:** Always construct the URL as `ip-api.com/json/{proxyHost}` when `proxyServer` is provided. Fall back to bare endpoint only for "direct" (no proxy) sessions.
