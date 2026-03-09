# External Version Sync Design

Date: 2026-03-09

## Goal

Create a pubm plugin that synchronizes version references across non-package files (docs, plugin metadata, CI configs, etc.) during the version bump pipeline, plus a discover command and Claude Code skill.

## Components

### 1. Plugin Factory: `externalVersionSync()`

Location: `src/plugins/external-version-sync.ts`

Returns a `PubmPlugin` with an `afterVersion` hook that:
- Reads each configured target file
- JSON files: updates value at `jsonPath` (e.g., `"version"`)
- Text files: replaces matches of `pattern` regex with new version
- Writes updated files and stages them with git (included in version bump commit)

Config usage:
```ts
export default defineConfig({
  plugins: [
    externalVersionSync({
      targets: [
        { file: "plugins/.claude-plugin/plugin.json", jsonPath: "version" },
        { file: "README.md", pattern: /pubm@[\d.]+/g },
        { file: ".github/workflows/ci.yaml", pattern: /pubm-action@v[\d.]+/g },
      ],
    }),
  ],
});
```

Target types:
- `{ file: string; jsonPath: string }` — JSON field replacement
- `{ file: string; pattern: RegExp }` — Regex pattern replacement in text files

### 2. Discover Command: `pubm sync --discover`

Location: `src/commands/sync.ts`

Scans project files for current version references:
- JSON files: finds `"version": "<current>"` fields
- Text files: finds `@<current>`, `v<current>`, `<current>` patterns
- Excludes: `node_modules`, `.git`, `dist`, `coverage`, `CHANGELOG.md`, `pnpm-lock.yaml`, `package.json`, `jsr.json`
- Outputs discovered targets as config snippet ready to paste

### 3. Claude Code Skill: `version-sync`

Location: `plugins/pubm-plugin/skills/version-sync/`

Guides users through:
1. Run `pubm sync --discover` to find external version references
2. Add discovered targets to `pubm.config.ts` via `externalVersionSync()` plugin
3. Test with `pubm version --dry-run`

### 4. `publish-setup` Integration

Add step 10 to existing 9-step setup workflow:
- Ask if project has non-package version references
- Run discover
- Add plugin to config based on results
