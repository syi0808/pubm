---
name: version-sync
description: Set up external version synchronization for non-package version references
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
  - Glob
  - Grep
  - AskUserQuestion
---

# Set Up External Version Sync

Guide users through configuring automatic version synchronization for files outside package.json (docs, plugin metadata, CI configs, etc.).

## Workflow

### 1. Discover Version References

Run `pubm sync --discover` to scan the project for external version references.

This finds:
- JSON files with `"version"` fields matching the current package version
- Text files with version patterns like `@x.y.z`, `vx.y.z`
- Excludes: `package.json`, `jsr.json`, `Cargo.toml`, lock files, `node_modules`, `.git`, `dist`

### 2. Review Discovered References

Show the user the discovered references and ask which ones to include in automatic sync. Some references might be intentionally pinned to a different version.

### 3. Add Plugin to Config

Read the current `pubm.config.ts`. If it exists, add `externalVersionSync()` to the `plugins` array. If it doesn't exist, create one.

The import comes from `pubm`:
```typescript
import { defineConfig, externalVersionSync } from "pubm";
```

Example config with the plugin:
```typescript
import { defineConfig, externalVersionSync } from "pubm";

export default defineConfig({
  registries: ["npm", "jsr"],
  plugins: [
    externalVersionSync({
      targets: [
        { file: "plugins/.claude-plugin/plugin.json", jsonPath: "version" },
        { file: "README.md", pattern: /pubm@[\d.]+/g },
      ],
    }),
  ],
});
```

### 4. Add Custom Targets (Optional)

Ask if the user has additional files with version references that weren't auto-detected. Common examples:
- CI workflow files referencing action versions
- Documentation with install commands
- Plugin/extension metadata files
- Docker image tags

### 5. Test the Setup

Run `pubm version --dry-run` to verify the sync would work correctly. If no changesets exist, create a test changeset first with `pubm add`.

### 6. Present Summary

Confirm the setup is complete and explain:
- Version sync runs automatically during `pubm version` and the main publish pipeline
- Synced file changes are included in the version bump commit
- New references can be added to the `targets` array in config

## Constraints

- Always use `externalVersionSync()` from `pubm` import (not a relative path)
- Always use `defineConfig()` for type safety
- Do not modify `package.json`, `jsr.json`, or `Cargo.toml` targets — these are handled by pubm's core version replacement
- When editing existing config, preserve all existing settings and plugins
