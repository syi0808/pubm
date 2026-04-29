---
packages/core: patch
packages/runner: patch
---

Keep silent live commands from showing stale task output, invoke captured write callbacks without waiting for renderer shutdown, and prevent clipped terminal styles or links from leaking into later live-frame lines.
