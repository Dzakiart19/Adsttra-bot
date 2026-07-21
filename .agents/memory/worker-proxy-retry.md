---
name: Worker proxy retry parity
description: runWorker() must have the same proxy retry logic as local sequential mode
---

**Rule:** `runWorker(proxyPool?)` accepts the ProxyService pool from bootstrap. On proxy errors (ERR_PROXY, ERR_TIMED_OUT, ERR_CONNECTION, ERR_TUNNEL, net::ERR), retry with next pool proxy up to min(5, pool.size) times before throwing to BullMQ.

**Why:** Without this, distributed mode silently failed on bad proxies while local mode retried up to 5 times — inconsistent behavior depending on whether Redis was available.

**How to apply:** Pass `proxyPool` from `bootstrap()` → `runWorker(proxyPool)`. Proxy override per-attempt: `{ ...job.data, proxy: { host, port } }`.
