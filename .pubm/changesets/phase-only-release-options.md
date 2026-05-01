---
packages/core::js: major
packages/pubm::js: major
packages/plugins/plugin-brew::js: major
---

Simplify release workflow options around Direct Release and Split CI Release. Bare `pubm` now represents Direct Release, while `--phase prepare` runs Prepare for CI publish and `--phase publish` runs Publish prepared release without the old release mode option.
