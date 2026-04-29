---
packages/runner: patch
---

Prevent live task rendering from being corrupted by stdout and stderr output during interactive runs, and keep task output previews within the renderer's terminal-aware live frame budget.
