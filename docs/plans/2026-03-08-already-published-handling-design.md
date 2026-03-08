# Already-Published Package Handling Design

## Goal

When a specific version is already published on a registry, warn and skip instead of failing. The pipeline continues normally for remaining registries.

## Approach: Hybrid (Pre-check + Error Catch Fallback)

### 1. Registry: `isVersionPublished(version)` method

Add to each registry class:

- **NpmRegistry** — `GET registry.npmjs.org/{name}/{version}`, 200 = exists
- **JsrRegistry** — JSR API version lookup
- **CratesRegistry** — `GET crates.io/api/v1/crates/{name}/{version}`, 200 = exists
- **CustomRegistry** — same as npm, using custom registry URL

### 2. Pre-check in publish tasks (primary)

Before calling `publish()`:

1. Call `isVersionPublished(version)`
2. If already published:
   - Set task title: `[SKIPPED] {registry}: v{version} already published`
   - Output warning via `task.output`
   - Call `task.skip()`

### 3. Error catch fallback (secondary)

If pre-check passes but publish throws "already exists" error:

- Catch the error
- Apply same warning + skip treatment
- Handles race conditions (published between check and attempt)

### 4. Dry-run publish

Same logic applied to dry-run tasks — check before dry-run, skip if already published.

## Unchanged

- Version bump, git tag, post-publish — proceed normally even if all registries skipped
- Rollback logic — no changes
- Prerequisites/conditions check — no changes

## Warning display

- `task.output`: warning message
- Task title: `[SKIPPED]` prefix
- `task.skip()`: listr2 skip state
