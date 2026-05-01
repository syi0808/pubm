---
packages/core: patch
packages/plugins/plugin-brew: patch
---

Preserve GitHub Release validation failures instead of treating every 422 as an existing release, clean up SIGINT handlers reliably, and skip Homebrew publish checks during prepare-only runs.
