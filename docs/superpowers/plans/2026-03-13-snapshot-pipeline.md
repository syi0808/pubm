# Snapshot Pipeline Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove changeset pre-release/snapshot features and add `pubm --snapshot [tag]` with a dedicated snapshot publish pipeline.

**Architecture:** Delete `prerelease/` module entirely, move `generateSnapshotVersion` to `utils/snapshot.ts`. Add `--snapshot` CLI option that triggers a separate pipeline in `runner.ts` — temp manifest swap → publish → restore → tag push. Config flattens `snapshot: { ... }` to top-level `snapshotTemplate`.

**Tech Stack:** TypeScript, Commander.js, listr2, semver, vitest

---

## Chunk 1: Delete Pre-release & Snapshot, Move Snapshot Utility

### Task 1: Move `generateSnapshotVersion` to `utils/snapshot.ts`

**Files:**
- Create: `packages/core/src/utils/snapshot.ts`
- Create: `packages/core/tests/unit/utils/snapshot.test.ts`
- Delete: `packages/core/src/prerelease/snapshot.ts`
- Delete: `packages/core/tests/unit/prerelease/snapshot.test.ts`

- [ ] **Step 1: Create `utils/snapshot.ts` with updated interface**

```typescript
// packages/core/src/utils/snapshot.ts
export interface SnapshotOptions {
  tag?: string;
  baseVersion: string;
  template?: string;
  commit?: string;
}

function formatTimestamp(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  const seconds = String(date.getUTCSeconds()).padStart(2, "0");
  return `${year}${month}${day}T${hours}${minutes}${seconds}`;
}

export function generateSnapshotVersion(options: SnapshotOptions): string {
  const tag = options.tag ?? "snapshot";
  const base = options.baseVersion;
  const now = new Date();
  const timestamp = formatTimestamp(now);

  if (options.template) {
    return options.template
      .replace(/\{base\}/g, base)
      .replace(/\{tag\}/g, tag)
      .replace(/\{timestamp\}/g, timestamp)
      .replace(/\{commit\}/g, options.commit ?? "");
  }

  return `${base}-${tag}-${timestamp}`;
}
```

- [ ] **Step 2: Create test file at `packages/core/tests/unit/utils/snapshot.test.ts`**

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateSnapshotVersion } from "../../../src/utils/snapshot.js";

describe("generateSnapshotVersion", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-04T12:30:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should generate snapshot version with base version", () => {
    const result = generateSnapshotVersion({
      tag: "canary",
      baseVersion: "1.2.0",
    });
    expect(result).toBe("1.2.0-canary-20260304T123000");
  });

  it("should use custom template", () => {
    const result = generateSnapshotVersion({
      tag: "dev",
      baseVersion: "1.0.0",
      template: "{base}-{tag}-{commit}",
      commit: "abc1234",
    });
    expect(result).toBe("1.0.0-dev-abc1234");
  });

  it("should default tag to snapshot", () => {
    const result = generateSnapshotVersion({ baseVersion: "2.0.0" });
    expect(result).toBe("2.0.0-snapshot-20260304T123000");
  });
});
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `cd packages/core && bun vitest --run tests/unit/utils/snapshot.test.ts`
Expected: 3 tests PASS

- [ ] **Step 4: Delete old prerelease test and source files**

```bash
rm packages/core/tests/unit/prerelease/snapshot.test.ts
rm packages/core/src/prerelease/snapshot.ts
```

- [ ] **Step 5: Run full test suite to check for broken imports**

Run: `cd packages/core && bun vitest --run`
Expected: Some tests may fail due to missing imports (prerelease/index.ts still references snapshot.ts). This is expected and will be fixed in the next task.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/utils/snapshot.ts packages/core/tests/unit/utils/snapshot.test.ts
git add packages/core/src/prerelease/snapshot.ts packages/core/tests/unit/prerelease/snapshot.test.ts
git commit -m "refactor: move generateSnapshotVersion to utils/snapshot, remove useCalculatedVersion"
```

### Task 2: Delete pre-release module and CLI commands

**Files:**
- Delete: `packages/core/src/prerelease/pre.ts`
- Delete: `packages/core/src/prerelease/index.ts`
- Delete: `packages/core/tests/unit/prerelease/pre.test.ts`
- Delete: `packages/pubm/src/commands/pre.ts`
- Delete: `packages/pubm/src/commands/snapshot.ts`
- Modify: `packages/pubm/src/commands/changesets.ts:1-22` — remove pre/snapshot imports and registrations
- Modify: `packages/core/src/index.ts:108-115` — update exports

- [ ] **Step 1: Delete pre-release files**

```bash
rm packages/core/src/prerelease/pre.ts
rm packages/core/src/prerelease/index.ts
rm -r packages/core/tests/unit/prerelease/
rm packages/pubm/src/commands/pre.ts
rm packages/pubm/src/commands/snapshot.ts
```

- [ ] **Step 2: Remove pre/snapshot from `changesets.ts`**

In `packages/pubm/src/commands/changesets.ts`, remove the imports and calls for `registerPreCommand` and `registerSnapshotCommand`. Keep `registerAddCommand`, `registerChangelogCommand`, `registerStatusCommand`, `registerVersionCommand`, `registerMigrateCommand`.

Before (lines 1-22):
```typescript
import { registerAddCommand } from "./add.js";
import { registerChangelogCommand } from "./changelog.js";
import { registerMigrateCommand } from "./migrate.js";
import { registerPreCommand } from "./pre.js";
import { registerSnapshotCommand } from "./snapshot.js";
import { registerStatusCommand } from "./status.js";
import { registerVersionCommand } from "./version-cmd.js";
```

After:
```typescript
import { registerAddCommand } from "./add.js";
import { registerChangelogCommand } from "./changelog.js";
import { registerMigrateCommand } from "./migrate.js";
import { registerStatusCommand } from "./status.js";
import { registerVersionCommand } from "./version-cmd.js";
```

Also remove the `registerPreCommand(changesets)` and `registerSnapshotCommand(changesets)` calls inside the function body.

- [ ] **Step 3: Update `packages/core/src/index.ts` exports**

Remove lines 108-115 (prerelease exports):
```typescript
// DELETE these lines:
export type { PreState } from "./prerelease/index.js";
export type { SnapshotOptions } from "./prerelease/index.js";
export {
  enterPreMode,
  exitPreMode,
  generateSnapshotVersion,
  readPreState,
} from "./prerelease/index.js";
```

Add new export for the moved snapshot utility:
```typescript
export type { SnapshotOptions } from "./utils/snapshot.js";
export { generateSnapshotVersion } from "./utils/snapshot.js";
```

- [ ] **Step 4: Remove pre-release logic from `version-cmd.ts`**

In `packages/pubm/src/commands/version-cmd.ts`:
- Remove `readPreState` import (from `@pubm/core`)
- Remove `PreState` type import
- Remove `const preState = readPreState(cwd)` call (~line 82)
- Remove `computePreReleaseVersion()` function (lines 188-206)
- Remove `updatePreState()` function (lines 208-225)
- Remove any conditional blocks that branch on `preState` (~lines 92-96, 134-136)

The version calculation should simply use `bump.newVersion` from `calculateVersionBumps()` without any pre-release transformation.

- [ ] **Step 5: Delete the prerelease directory**

```bash
rmdir packages/core/src/prerelease
```

- [ ] **Step 6: Run tests to verify nothing is broken**

Run: `cd packages/core && bun vitest --run`
Expected: All tests PASS (prerelease tests are deleted, snapshot test is at new location)

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor: remove pre-release module and CLI commands"
```

### Task 3: Update config — flatten `snapshot` to `snapshotTemplate`

**Files:**
- Modify: `packages/core/src/config/types.ts:23-26, 43` — remove `SnapshotConfig`, replace with `snapshotTemplate`
- Modify: `packages/core/src/config/defaults.ts:19-22, 68-69` — remove `defaultSnapshot`, update `resolveConfig()`

- [ ] **Step 1: Update `types.ts`**

In `packages/core/src/config/types.ts`:
- Delete `SnapshotConfig` interface (lines 23-26)
- Replace `snapshot?: SnapshotConfig` field in `PubmConfig` with `snapshotTemplate?: string`
- Update `ResolvedPubmConfig` to have `snapshotTemplate: string` instead of `snapshot: Required<SnapshotConfig>`

- [ ] **Step 2: Update `defaults.ts`**

In `packages/core/src/config/defaults.ts`:
- Remove `SnapshotConfig` import from `./types.js`
- Delete `defaultSnapshot` constant (lines 19-22)
- Add `snapshotTemplate: "{tag}-{timestamp}"` to `defaultConfig` object
- In `resolveConfig()`, replace the snapshot merge logic (line 69: `snapshot: { ...defaultSnapshot, ...config.snapshot },`) with:
  ```typescript
  snapshotTemplate: config.snapshotTemplate ?? defaults.snapshotTemplate,
  ```

- [ ] **Step 3: Search for any other references to old snapshot config**

Run: `grep -r "snapshot\." packages/core/src/config/ --include="*.ts"`
Run: `grep -r "SnapshotConfig" packages/ --include="*.ts"`
Fix any remaining references.

- [ ] **Step 4: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/config/types.ts packages/core/src/config/defaults.ts
git commit -m "refactor: flatten snapshot config to top-level snapshotTemplate"
```

---

## Chunk 2: Add `--snapshot` CLI Option & Snapshot Pipeline

### Task 4: Add `snapshot` option to `Options` type

**Files:**
- Modify: `packages/core/src/types/options.ts:9-111` — add `snapshot` field

- [ ] **Step 1: Add `snapshot` field to `Options` interface**

In `packages/core/src/types/options.ts`, add after the `preflight` field (~line 83):

```typescript
  /**
   * @description Snapshot mode: publish a temporary snapshot version
   */
  snapshot?: string | boolean;
```

- [ ] **Step 2: Verify `resolveOptions` passes `snapshot` through**

Check `packages/core/src/options.ts` — `resolveOptions()` spreads all `Options` fields via `{ ...defaultOptions, ...defined }`. Since `snapshot` is not in `defaultOptions`, it will pass through from `defined`. No changes needed, but verify this.

- [ ] **Step 3: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/types/options.ts
git commit -m "feat: add snapshot option to Options type"
```

### Task 5: Add `--snapshot` CLI option to Commander

**Files:**
- Modify: `packages/pubm/src/cli.ts:24-44, 46-58, 74-114` — add snapshot option, validation, resolve

- [ ] **Step 1: Add `snapshot` to `CliOptions` interface**

In `packages/pubm/src/cli.ts`, add to `CliOptions` (~line 38):
```typescript
  snapshot?: string | boolean;
```

- [ ] **Step 2: Add `--snapshot` Commander option**

After `--preflight` option (~line 103), add:
```typescript
    .option(
      "--snapshot [tag]",
      "Publish a temporary snapshot version (default tag: snapshot)",
    )
```

- [ ] **Step 3: Add validation in the action handler**

At the start of the action handler (~line 119, after `console.clear()`), add:
```typescript
        if (options.snapshot && options.preflight) {
          throw new Error(
            "Cannot use --snapshot and --preflight together.",
          );
        }
```

- [ ] **Step 4: Update `resolveCliOptions` to pass snapshot**

In `resolveCliOptions()`, add:
```typescript
    snapshot: options.snapshot,
```

- [ ] **Step 5: Add snapshot pipeline branch in action handler**

After the validation check, before the existing `if (options.preflight)` block (~line 136), add a new branch:

```typescript
        if (options.snapshot) {
          const snapshotTag =
            typeof options.snapshot === "string"
              ? options.snapshot
              : "snapshot";

          // Version is a placeholder — runner reads actual version from manifest
          // and replaces it with the generated snapshot version.
          await pubm({
            ...resolveCliOptions({
              ...options,
              version: "snapshot",
              tag: snapshotTag,
            } as CliOptions),
            snapshot: snapshotTag,
          });
          return;
        }
```

- [ ] **Step 6: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/pubm/src/cli.ts
git commit -m "feat: add --snapshot CLI option with preflight validation"
```

### Task 6: Implement snapshot pipeline in runner

**Files:**
- Modify: `packages/core/src/tasks/runner.ts:364-990` — add snapshot pipeline branch
- Modify: `packages/core/src/index.ts` — export `generateSnapshotVersion` (already done in Task 2)

- [ ] **Step 1: Add snapshot imports to runner.ts**

At the top of `packages/core/src/tasks/runner.ts`, add:
```typescript
import { generateSnapshotVersion } from "../utils/snapshot.js";
import { loadConfig } from "../config/loader.js";
```

(Check if `loadConfig` is already imported — if so, skip.)

- [ ] **Step 2: Add snapshot pipeline in `run()` function**

In `packages/core/src/tasks/runner.ts`, inside `run()`, after `if (options.contents) process.chdir(options.contents);` (~line 381), add a new branch before the existing `if (options.preflight)`:

```typescript
    if (options.snapshot) {
      // Snapshot pipeline: prerequisites → conditions → test → build → temp publish → tag push
      await prerequisitesCheckTask({
        skip: options.skipPrerequisitesCheck,
      }).run(ctx);

      await requiredConditionsCheckTask({
        skip: options.skipConditionsCheck,
      }).run(ctx);

      const pipelineListrOptions =
        options.ci || isCI ? createCiListrOptions<Ctx>() : undefined;

      await createListr<Ctx>(
        [
          {
            skip: options.skipTests,
            title: "Running tests",
            task: async (ctx, task): Promise<void> => {
              const packageManager = await getPackageManager();
              const command = `${packageManager} run ${ctx.testScript}`;
              task.title = `Running tests (${command})`;
              task.output = `Executing \`${command}\``;
              try {
                await exec(packageManager, ["run", ctx.testScript], {
                  throwOnError: true,
                });
              } catch (error) {
                throw new AbstractError(
                  `Test script '${ctx.testScript}' failed.`,
                  { cause: error },
                );
              }
            },
          },
          {
            skip: options.skipBuild,
            title: "Building the project",
            task: async (ctx, task): Promise<void> => {
              const packageManager = await getPackageManager();
              const command = `${packageManager} run ${ctx.buildScript}`;
              task.title = `Building the project (${command})`;
              task.output = `Executing \`${command}\``;
              try {
                await exec(packageManager, ["run", ctx.buildScript], {
                  throwOnError: true,
                });
              } catch (error) {
                throw new AbstractError(
                  `Build script '${ctx.buildScript}' failed.`,
                  { cause: error },
                );
              }
            },
          },
          {
            title: "Publishing snapshot",
            task: async (ctx, task): Promise<void> => {
              const snapshotTag =
                typeof options.snapshot === "string"
                  ? options.snapshot
                  : "snapshot";

              // Check for monorepo
              const packageInfos = await discoverPackageInfos(process.cwd());
              if (packageInfos.length > 1) {
                throw new AbstractError(
                  "Snapshot publishing is only supported for single-package projects.",
                );
              }

              // Read current version from manifest
              const pkgJson = await getPackageJson();
              const currentVersion = pkgJson.version ?? "0.0.0";

              // Generate snapshot version
              const config = await loadConfig(process.cwd());
              const snapshotVersion = generateSnapshotVersion({
                baseVersion: currentVersion,
                tag: snapshotTag,
                template: config?.snapshotTemplate,
              });

              ctx.version = snapshotVersion;
              task.title = `Publishing snapshot (${snapshotVersion})`;
              task.output = `Snapshot version: ${snapshotVersion}`;

              // Temporarily replace manifest version
              const replaced = await replaceVersion(
                snapshotVersion,
                ctx.packages,
              );

              try {
                // Publish with snapshot tag
                task.output = `Publishing to registries with tag "${snapshotTag}"...`;
                ctx.tag = snapshotTag;

                const publishTasks = await collectPublishTasks(ctx);
                await createListr<Ctx>(publishTasks, {
                  concurrent: true,
                }).run(ctx);
              } finally {
                // Restore original version
                task.output = "Restoring original manifest version...";
                await replaceVersion(currentVersion, ctx.packages);
              }

              task.output = `Published ${snapshotVersion}`;
            },
          },
          {
            title: "Creating and pushing snapshot tag",
            skip: (ctx) => !!ctx.preview,
            task: async (ctx, task): Promise<void> => {
              const git = new Git();
              const tagName = `v${ctx.version}`;
              task.output = `Creating tag ${tagName}...`;

              const headCommit = await git.head();
              await git.createTag(tagName, headCommit);

              task.output = `Pushing tag ${tagName}...`;
              await git.push("--tags");
              task.output = `Tag ${tagName} pushed.`;
            },
          },
        ],
        pipelineListrOptions,
      ).run(ctx);

      const registries = collectRegistries(ctx);
      const parts: string[] = [];
      for (const registryKey of registries) {
        const descriptor = registryCatalog.get(registryKey);
        if (!descriptor?.resolveDisplayName) continue;
        const names = await descriptor.resolveDisplayName(ctx);
        for (const name of names) {
          parts.push(`${color.bold(name)} on ${descriptor.label}`);
        }
      }

      console.log(
        `\n\n📸 Successfully published snapshot ${parts.join(", ")} ${color.blueBright(ctx.version)} 📸\n`,
      );

      return;
    }
```

- [ ] **Step 3: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 4: Run existing tests**

Run: `cd packages/core && bun vitest --run`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/tasks/runner.ts
git commit -m "feat: implement snapshot publish pipeline in runner"
```

### Task 7: Delete `pubm/tests/unit/commands/snapshot.test.ts` if it exists

**Files:**
- Delete: `packages/pubm/tests/unit/commands/snapshot.test.ts` (tests for the removed CLI snapshot command)

- [ ] **Step 1: Delete old CLI snapshot test**

```bash
rm -f packages/pubm/tests/unit/commands/snapshot.test.ts
```

- [ ] **Step 2: Run all tests to verify nothing references deleted files**

Run: `bun run test`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "test: remove obsolete snapshot CLI command tests"
```

---

## Chunk 3: Update Documentation

### Task 8: Update English documentation

**Files:**
- Modify: `website/src/content/docs/guides/changesets.mdx:179-212` — remove pre-release and snapshot sections
- Modify: `website/src/content/docs/reference/cli.mdx:34-36, 290-314` — remove pre/snapshot commands, add `--snapshot`
- Modify: `website/src/content/docs/reference/config.mdx:51-54, 236-262, 396-398` — update snapshot config

- [ ] **Step 1: Update `changesets.mdx`**

Delete the "## Pre-release mode" section (lines 179-194) and "## Snapshot releases" section (lines 196-212).

- [ ] **Step 2: Update `cli.mdx`**

1. Delete table rows for `pubm changesets pre enter/exit` and `pubm changesets snapshot` (lines 34-36)
2. Delete "## `pubm changesets pre`" section (lines 290-297)
3. Delete "## `pubm changesets snapshot`" section (lines 299-314)
4. Add `--snapshot [tag]` to the `pubm` command options table:

```markdown
| `--snapshot [tag]` | Publish a temporary snapshot version (default tag: `snapshot`) |
```

- [ ] **Step 3: Update `config.mdx`**

1. Delete `snapshot: { ... }` from default config example (lines 51-54)
2. Add `snapshotTemplate: "{tag}-{timestamp}"` to default config example
3. Delete "## `snapshot`" section (lines 236-262)
4. Add new section:

```markdown
## `snapshotTemplate`

Template for generating snapshot version strings when using `pubm --snapshot`.

**Type:** `string`
**Default:** `"{tag}-{timestamp}"`

Available template variables:
- `{base}` — Current package version from manifest
- `{tag}` — Snapshot tag (from `--snapshot [tag]`, default: `snapshot`)
- `{timestamp}` — UTC timestamp in `YYYYMMDDTHHmmss` format
- `{commit}` — Current git commit SHA
```

5. Delete `snapshot: { useCalculatedVersion: true }` from mixed ecosystem example (lines 396-398)

- [ ] **Step 4: Verify docs build**

Run: `bun run build:site`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add website/src/content/docs/guides/changesets.mdx
git add website/src/content/docs/reference/cli.mdx
git add website/src/content/docs/reference/config.mdx
git commit -m "docs: remove pre-release/snapshot sections, add --snapshot option"
```

### Task 9: Update translated documentation (sonnet 4.6 subagent)

**Files:**
- Modify: `website/src/content/docs/{de,es,fr,ko,zh-cn}/guides/changesets.mdx`
- Modify: `website/src/content/docs/{de,es,fr,ko,zh-cn}/reference/cli.mdx`
- Modify: `website/src/content/docs/{de,es,fr,ko,zh-cn}/reference/config.mdx`

Use sonnet 4.6 subagent for each language. Apply the same changes as Task 8 but in the respective language.

- [ ] **Step 1: Update German (de) translations**

Apply same deletions/additions as Task 8 to `de/guides/changesets.mdx`, `de/reference/cli.mdx`, `de/reference/config.mdx`.

- [ ] **Step 2: Update Spanish (es) translations**

Apply same changes to `es/` docs.

- [ ] **Step 3: Update French (fr) translations**

Apply same changes to `fr/` docs.

- [ ] **Step 4: Update Korean (ko) translations**

Apply same changes to `ko/` docs.

- [ ] **Step 5: Update Chinese (zh-cn) translations**

Apply same changes to `zh-cn/` docs.

- [ ] **Step 6: Verify docs build**

Run: `bun run build:site`
Expected: Build succeeds

- [ ] **Step 7: Commit**

```bash
git add website/src/content/docs/de/ website/src/content/docs/es/ website/src/content/docs/fr/ website/src/content/docs/ko/ website/src/content/docs/zh-cn/
git commit -m "docs: update translated documentation for snapshot pipeline changes"
```

---

## Chunk 4: Final Verification

### Task 10: Full verification

- [ ] **Step 1: Run format**

Run: `bun run format`
Expected: No errors

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 3: Run all tests**

Run: `bun run test`
Expected: All tests PASS

- [ ] **Step 4: Verify `prerelease/` directory is fully removed**

```bash
ls packages/core/src/prerelease/ 2>&1
# Expected: No such file or directory
```

- [ ] **Step 5: Verify no stale references**

```bash
grep -r "prerelease" packages/ --include="*.ts" -l
grep -r "pre\.json" packages/ --include="*.ts" -l
grep -r "enterPreMode\|exitPreMode\|readPreState\|PreState" packages/ --include="*.ts" -l
grep -r "SnapshotConfig" packages/ --include="*.ts" -l
grep -r "useCalculatedVersion" packages/ --include="*.ts" -l
grep -r "prereleaseTemplate" packages/ --include="*.ts" -l
```

Expected: `prerelease` grep will match `semver.prerelease()` usage in `runner.ts`, `required-missing-information.ts`, `github-release.ts` — these are legitimate semver function imports, NOT stale references. All other greps should return no matches.

- [ ] **Step 6: Build docs site**

Run: `bun run build:site`
Expected: Build succeeds
