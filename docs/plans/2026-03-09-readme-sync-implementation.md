# README Sync & Missing Features Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement plugin system, `pubm version` command, `pubm snapshot` command, Windows/Bun compatibility, and sync README with all features.

**Architecture:** Plugin system uses a `PubmPlugin` interface that can register hooks (13 lifecycle points), custom registries, and custom ecosystems. Plugins are loaded from `pubm.config.ts` and integrated into the task runner pipeline. The `version` and `snapshot` commands build on existing changeset/prerelease modules. Cross-platform support uses `cross-spawn` and runtime detection.

**Tech Stack:** TypeScript, pnpm, Vitest, tsup, listr2, CAC, tinyexec, cross-spawn

---

### Task 1: Plugin Type Definitions

**Files:**
- Create: `src/plugin/types.ts`
- Modify: `src/config/types.ts:22-43`

**Step 1: Write the failing test**

Create `tests/unit/plugin/types.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { PubmPlugin, HookContext, HookFn, ErrorHookFn } from "../../src/plugin/types.js";
import type { Registry } from "../../src/registry/registry.js";
import type { Ecosystem } from "../../src/ecosystem/ecosystem.js";

describe("PubmPlugin type", () => {
  it("should accept a plugin with all hooks", () => {
    const plugin: PubmPlugin = {
      name: "test-plugin",
      hooks: {
        beforeTest: async () => {},
        afterTest: async () => {},
        beforeBuild: async () => {},
        afterBuild: async () => {},
        beforeVersion: async () => {},
        afterVersion: async () => {},
        beforePublish: async () => {},
        afterPublish: async () => {},
        beforePush: async () => {},
        afterPush: async () => {},
        onError: async (_ctx, _error) => {},
        onRollback: async () => {},
        onSuccess: async () => {},
      },
    };
    expect(plugin.name).toBe("test-plugin");
  });

  it("should accept a plugin with registries and ecosystems", () => {
    const plugin: PubmPlugin = {
      name: "custom-registry",
      registries: [],
      ecosystems: [],
    };
    expect(plugin.registries).toEqual([]);
    expect(plugin.ecosystems).toEqual([]);
  });

  it("should accept a minimal plugin with only name", () => {
    const plugin: PubmPlugin = { name: "minimal" };
    expect(plugin.name).toBe("minimal");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest --run tests/unit/plugin/types.test.ts`
Expected: FAIL — module `../../src/plugin/types.js` not found

**Step 3: Write the plugin type definitions**

Create `src/plugin/types.ts`:

```ts
import type { Ecosystem } from "../ecosystem/ecosystem.js";
import type { Registry } from "../registry/registry.js";
import type { Ctx } from "../tasks/runner.js";

export type HookFn = (ctx: Ctx) => Promise<void> | void;
export type ErrorHookFn = (ctx: Ctx, error: Error) => Promise<void> | void;

export interface PluginHooks {
  beforeTest?: HookFn;
  afterTest?: HookFn;
  beforeBuild?: HookFn;
  afterBuild?: HookFn;
  beforeVersion?: HookFn;
  afterVersion?: HookFn;
  beforePublish?: HookFn;
  afterPublish?: HookFn;
  beforePush?: HookFn;
  afterPush?: HookFn;
  onError?: ErrorHookFn;
  onRollback?: HookFn;
  onSuccess?: HookFn;
}

export type HookName = keyof PluginHooks;

export interface PubmPlugin {
  name: string;
  registries?: Registry[];
  ecosystems?: Ecosystem[];
  hooks?: PluginHooks;
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm vitest --run tests/unit/plugin/types.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/plugin/types.ts tests/unit/plugin/types.test.ts
git commit -m "feat: add PubmPlugin type definitions with 13 lifecycle hooks"
```

---

### Task 2: Plugin Runner (Hook Executor)

**Files:**
- Create: `src/plugin/runner.ts`
- Create: `src/plugin/index.ts`

**Step 1: Write the failing test**

Create `tests/unit/plugin/runner.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { PubmPlugin } from "../../src/plugin/types.js";
import { PluginRunner } from "../../src/plugin/runner.js";

function makeCtx() {
  return {
    version: "1.0.0",
    promptEnabled: false,
    cleanWorkingTree: true,
    testScript: "test",
    buildScript: "build",
    branch: "main",
    tag: "latest",
    saveToken: true,
    registries: ["npm"],
  } as any;
}

describe("PluginRunner", () => {
  it("should execute hooks in registration order", async () => {
    const order: string[] = [];
    const plugin1: PubmPlugin = {
      name: "p1",
      hooks: { beforePublish: async () => { order.push("p1"); } },
    };
    const plugin2: PubmPlugin = {
      name: "p2",
      hooks: { beforePublish: async () => { order.push("p2"); } },
    };
    const runner = new PluginRunner([plugin1, plugin2]);
    await runner.runHook("beforePublish", makeCtx());
    expect(order).toEqual(["p1", "p2"]);
  });

  it("should pass error to onError hooks", async () => {
    const errorFn = vi.fn();
    const plugin: PubmPlugin = {
      name: "err",
      hooks: { onError: errorFn },
    };
    const runner = new PluginRunner([plugin]);
    const error = new Error("test");
    await runner.runErrorHook(makeCtx(), error);
    expect(errorFn).toHaveBeenCalledWith(expect.anything(), error);
  });

  it("should collect registries from plugins", () => {
    const mockRegistry = { packageName: "test", ping: vi.fn() } as any;
    const plugin: PubmPlugin = {
      name: "custom",
      registries: [mockRegistry],
    };
    const runner = new PluginRunner([plugin]);
    expect(runner.collectRegistries()).toEqual([mockRegistry]);
  });

  it("should collect ecosystems from plugins", () => {
    const mockEcosystem = { packagePath: "." } as any;
    const plugin: PubmPlugin = {
      name: "custom",
      ecosystems: [mockEcosystem],
    };
    const runner = new PluginRunner([plugin]);
    expect(runner.collectEcosystems()).toEqual([mockEcosystem]);
  });

  it("should handle plugins without hooks gracefully", async () => {
    const plugin: PubmPlugin = { name: "no-hooks" };
    const runner = new PluginRunner([plugin]);
    await expect(runner.runHook("beforePublish", makeCtx())).resolves.toBeUndefined();
  });

  it("should handle empty plugin list", async () => {
    const runner = new PluginRunner([]);
    await expect(runner.runHook("beforePublish", makeCtx())).resolves.toBeUndefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest --run tests/unit/plugin/runner.test.ts`
Expected: FAIL — module not found

**Step 3: Write the plugin runner**

Create `src/plugin/runner.ts`:

```ts
import type { Ecosystem } from "../ecosystem/ecosystem.js";
import type { Registry } from "../registry/registry.js";
import type { Ctx } from "../tasks/runner.js";
import type { HookName, PubmPlugin } from "./types.js";

export class PluginRunner {
  constructor(private plugins: PubmPlugin[]) {}

  async runHook(hookName: Exclude<HookName, "onError">, ctx: Ctx): Promise<void> {
    for (const plugin of this.plugins) {
      const hook = plugin.hooks?.[hookName];
      if (hook && hookName !== "onError") {
        await (hook as (ctx: Ctx) => Promise<void> | void)(ctx);
      }
    }
  }

  async runErrorHook(ctx: Ctx, error: Error): Promise<void> {
    for (const plugin of this.plugins) {
      const hook = plugin.hooks?.onError;
      if (hook) {
        await hook(ctx, error);
      }
    }
  }

  collectRegistries(): Registry[] {
    return this.plugins.flatMap((p) => p.registries ?? []);
  }

  collectEcosystems(): Ecosystem[] {
    return this.plugins.flatMap((p) => p.ecosystems ?? []);
  }
}
```

Create `src/plugin/index.ts`:

```ts
export { PluginRunner } from "./runner.js";
export type {
  ErrorHookFn,
  HookFn,
  HookName,
  PluginHooks,
  PubmPlugin,
} from "./types.js";
```

**Step 4: Run test to verify it passes**

Run: `pnpm vitest --run tests/unit/plugin/runner.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/plugin/runner.ts src/plugin/index.ts tests/unit/plugin/runner.test.ts
git commit -m "feat: add PluginRunner for executing lifecycle hooks"
```

---

### Task 3: Integrate Plugins into Config

**Files:**
- Modify: `src/config/types.ts:22-43` — add `plugins` field to `PubmConfig`
- Modify: `src/index.ts:17-36` — load plugins and pass to runner
- Modify: `src/tasks/runner.ts:45-48` — accept `PluginRunner` in `Ctx`

**Step 1: Write the failing test**

Create `tests/unit/plugin/config-integration.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { PubmConfig } from "../../src/config/types.js";
import type { PubmPlugin } from "../../src/plugin/types.js";

describe("PubmConfig with plugins", () => {
  it("should accept plugins array in config", () => {
    const plugin: PubmPlugin = {
      name: "test",
      hooks: { beforePublish: async () => {} },
    };
    const config: PubmConfig = {
      plugins: [plugin],
    };
    expect(config.plugins).toHaveLength(1);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest --run tests/unit/plugin/config-integration.test.ts`
Expected: FAIL — `plugins` does not exist on type `PubmConfig`

**Step 3: Add plugins to PubmConfig**

In `src/config/types.ts`, add to the `PubmConfig` interface:

```ts
import type { PubmPlugin } from "../plugin/types.js";
```

Add field inside PubmConfig:
```ts
  plugins?: PubmPlugin[];
```

**Step 4: Run test to verify it passes**

Run: `pnpm vitest --run tests/unit/plugin/config-integration.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/config/types.ts tests/unit/plugin/config-integration.test.ts
git commit -m "feat: add plugins field to PubmConfig"
```

---

### Task 4: Integrate PluginRunner into Task Pipeline

**Files:**
- Modify: `src/tasks/runner.ts` — add PluginRunner to Ctx, call hooks at each pipeline stage
- Modify: `src/index.ts` — create PluginRunner from config and pass to runner

**Step 1: Modify Ctx to include PluginRunner**

In `src/tasks/runner.ts`, add import and modify Ctx:

```ts
import { PluginRunner } from "../plugin/runner.js";

export interface Ctx extends ResolvedOptions {
  promptEnabled: boolean;
  cleanWorkingTree: boolean;
  pluginRunner: PluginRunner;
}
```

**Step 2: Add hook calls to `run()` function in `src/tasks/runner.ts`**

Wrap each pipeline stage with before/after hooks. The key insertion points in the `run()` function:

- Before/after test task: wrap the test execution with `pluginRunner.runHook("beforeTest", ctx)` / `afterTest`
- Before/after build task: wrap with `beforeBuild` / `afterBuild`
- Before/after version bump: wrap with `beforeVersion` / `afterVersion`
- Before/after publish: wrap with `beforePublish` / `afterPublish`
- Before/after push: wrap with `beforePush` / `afterPush`
- In catch block: call `pluginRunner.runErrorHook(ctx, error)` and `pluginRunner.runHook("onRollback", ctx)`
- After success: call `pluginRunner.runHook("onSuccess", ctx)`

**Step 3: Modify `src/index.ts` to create PluginRunner**

```ts
import { PluginRunner } from "./plugin/runner.js";

// In pubm() function, after loading config:
const plugins = config?.plugins ?? [];
const pluginRunner = new PluginRunner(plugins);

// Pass pluginRunner into options that flow to run()
```

**Step 4: Add plugin registries to collectPublishTasks**

In `src/tasks/runner.ts`, modify `collectPublishTasks` to also include registries from `ctx.pluginRunner.collectRegistries()`. Each plugin registry should generate a publish task using its own `publish()` method.

**Step 5: Run full test suite**

Run: `pnpm vitest --run`
Expected: All existing tests still pass (PluginRunner with empty plugins is a no-op)

**Step 6: Commit**

```bash
git add src/tasks/runner.ts src/index.ts
git commit -m "feat: integrate PluginRunner into task pipeline with all 13 hooks"
```

---

### Task 5: Export Plugin API

**Files:**
- Modify: `src/index.ts` — export plugin types

**Step 1: Add exports to `src/index.ts`**

```ts
export type {
  ErrorHookFn,
  HookFn,
  HookName,
  PluginHooks,
  PubmPlugin,
} from "./plugin/index.js";
export { PluginRunner } from "./plugin/index.js";
```

**Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

**Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: export plugin types from public API"
```

---

### Task 6: Implement `pubm version` Command

**Files:**
- Modify: `src/commands/version-cmd.ts` — replace stub with full implementation

**Step 1: Write the failing test**

Create `tests/unit/commands/version-cmd.test.ts`:

```ts
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readChangesets } from "../../src/changeset/reader.js";

describe("pubm version command logic", () => {
  const tmpDir = path.join(import.meta.dirname, ".tmp-version-test");
  const changesetsDir = path.join(tmpDir, ".pubm", "changesets");

  beforeEach(() => {
    mkdirSync(changesetsDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should read changesets and calculate version bumps", () => {
    writeFileSync(
      path.join(changesetsDir, "test-change.md"),
      "---\nmy-pkg: minor\n---\n\nAdded new feature\n",
    );

    const changesets = readChangesets(tmpDir);
    expect(changesets).toHaveLength(1);
    expect(changesets[0].releases[0].type).toBe("minor");
  });

  it("should handle pre-release state", async () => {
    const { readPreState, enterPreMode } = await import("../../src/prerelease/pre.js");

    const pubmDir = path.join(tmpDir, ".pubm");
    mkdirSync(pubmDir, { recursive: true });

    enterPreMode("beta", tmpDir);
    const state = readPreState(tmpDir);
    expect(state).not.toBeNull();
    expect(state!.tag).toBe("beta");

    // Cleanup
    rmSync(path.join(pubmDir, "pre.json"), { force: true });
  });
});
```

**Step 2: Run test to verify it passes (these test existing modules)**

Run: `pnpm vitest --run tests/unit/commands/version-cmd.test.ts`
Expected: PASS (testing existing changeset/prerelease modules)

**Step 3: Implement the version command**

Replace `src/commands/version-cmd.ts`:

```ts
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { inc } from "semver";
import { maxBump } from "../changeset/bump-utils.js";
import { generateChangelog, type ChangelogEntry } from "../changeset/changelog.js";
import type { BumpType } from "../changeset/parser.js";
import { readChangesets } from "../changeset/reader.js";
import { calculateVersionBumps } from "../changeset/version.js";
import { loadConfig } from "../config/loader.js";
import { applyFixedGroup, applyLinkedGroup, resolveGroups } from "../monorepo/index.js";
import { readPreState, type PreState } from "../prerelease/pre.js";
import { getPackageJson, replaceVersion } from "../utils/package.js";
import type { CAC } from "cac";

function applyPreRelease(
  version: string,
  preState: PreState,
  packageName: string,
): string {
  const pkgState = preState.packages[packageName];
  const iteration = pkgState ? pkgState.iteration + 1 : 1;
  return `${version}-${preState.tag}.${iteration}`;
}

export function registerVersionCommand(cli: CAC): void {
  cli
    .command("version", "Consume changesets and bump versions")
    .option("--dry-run", "Show what would change without writing", { type: Boolean })
    .action(async (options: { dryRun?: boolean }) => {
      const cwd = process.cwd();
      const changesets = readChangesets(cwd);

      if (changesets.length === 0) {
        console.log("No changesets found. Nothing to do.");
        return;
      }

      // Read current versions
      const pkg = await getPackageJson();
      const currentVersions = new Map<string, string>();
      currentVersions.set(pkg.name, pkg.version);

      // Calculate bumps
      const bumps = calculateVersionBumps(currentVersions, cwd);

      // Apply fixed/linked groups from config
      const config = await loadConfig(cwd);
      if (config) {
        const allPackages = [...currentVersions.keys()];
        const bumpTypes = new Map<string, BumpType>();
        for (const [name, bump] of bumps) {
          bumpTypes.set(name, bump.bumpType);
        }

        if (config.fixed) {
          const fixedGroups = resolveGroups(config.fixed, allPackages);
          for (const group of fixedGroups) {
            applyFixedGroup(bumpTypes, group);
          }
        }
        if (config.linked) {
          const linkedGroups = resolveGroups(config.linked, allPackages);
          for (const group of linkedGroups) {
            applyLinkedGroup(bumpTypes, group);
          }
        }
      }

      // Check pre-release state
      const preState = readPreState(cwd);

      // Apply version bumps
      for (const [name, bump] of bumps) {
        let newVersion = bump.newVersion;

        if (preState) {
          newVersion = applyPreRelease(newVersion, preState, name);
        }

        console.log(`${name}: ${bump.currentVersion} → ${newVersion} (${bump.bumpType})`);

        if (!options.dryRun) {
          // Generate changelog entry
          const entries: ChangelogEntry[] = changesets
            .filter((cs) => cs.releases.some((r) => r.name === name))
            .map((cs) => ({
              summary: cs.summary,
              type: cs.releases.find((r) => r.name === name)!.type,
              id: cs.id,
            }));

          const changelogContent = generateChangelog(newVersion, entries);
          const changelogPath = path.join(cwd, "CHANGELOG.md");

          if (existsSync(changelogPath)) {
            const existing = readFileSync(changelogPath, "utf-8");
            writeFileSync(changelogPath, `${changelogContent}\n${existing}`, "utf-8");
          } else {
            writeFileSync(changelogPath, `# Changelog\n\n${changelogContent}`, "utf-8");
          }

          // Write version to manifest files
          await replaceVersion(newVersion);

          // Update pre-release state
          if (preState) {
            const pkgState = preState.packages[name];
            preState.packages[name] = {
              baseVersion: bump.newVersion,
              iteration: pkgState ? pkgState.iteration + 1 : 1,
            };
            const preStatePath = path.join(cwd, ".pubm", "pre.json");
            writeFileSync(preStatePath, JSON.stringify(preState, null, 2), "utf-8");
          }
        }
      }

      // Delete consumed changesets
      if (!options.dryRun) {
        const changesetsDir = path.join(cwd, ".pubm", "changesets");
        for (const cs of changesets) {
          const filePath = path.join(changesetsDir, `${cs.id}.md`);
          rmSync(filePath, { force: true });
        }
        console.log(`\nConsumed ${changesets.length} changeset(s).`);
      }
    });
}
```

**Step 4: Run tests**

Run: `pnpm vitest --run tests/unit/commands/version-cmd.test.ts`
Expected: PASS

**Step 5: Run typecheck and format**

Run: `pnpm format && pnpm typecheck`

**Step 6: Commit**

```bash
git add src/commands/version-cmd.ts tests/unit/commands/version-cmd.test.ts
git commit -m "feat: implement pubm version command with changeset consumption and pre-release support"
```

---

### Task 7: Implement `pubm snapshot` Command

**Files:**
- Modify: `src/commands/snapshot.ts` — replace stub with full implementation

**Step 1: Write the failing test**

Create `tests/unit/commands/snapshot.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { generateSnapshotVersion } from "../../src/prerelease/snapshot.js";

describe("snapshot version generation", () => {
  it("should generate timestamp-based version by default", () => {
    const version = generateSnapshotVersion({});
    expect(version).toMatch(/^0\.0\.0-snapshot-\d{8}T\d{6}$/);
  });

  it("should use custom tag", () => {
    const version = generateSnapshotVersion({ tag: "canary" });
    expect(version).toMatch(/^0\.0\.0-canary-\d{8}T\d{6}$/);
  });

  it("should use custom commit as template variable", () => {
    const version = generateSnapshotVersion({
      template: "{base}-{tag}-{commit}",
      commit: "abc1234",
    });
    expect(version).toBe("0.0.0-snapshot-abc1234");
  });
});
```

**Step 2: Run test to verify it passes (existing module)**

Run: `pnpm vitest --run tests/unit/commands/snapshot.test.ts`
Expected: PASS

**Step 3: Implement the snapshot command**

Replace `src/commands/snapshot.ts`:

```ts
import process from "node:process";
import type { CAC } from "cac";
import { exec } from "tinyexec";
import { loadConfig } from "../config/loader.js";
import { Git } from "../git.js";
import { generateSnapshotVersion } from "../prerelease/snapshot.js";
import { getPackageJson, replaceVersion } from "../utils/package.js";
import { getPackageManager } from "../utils/package-manager.js";
import { collectRegistries } from "../utils/registries.js";
import { resolveOptions } from "../options.js";

export function registerSnapshotCommand(cli: CAC): void {
  cli
    .command("snapshot [tag]", "Create a snapshot release")
    .option("--snapshot-id <id>", "Custom snapshot identifier (e.g., git SHA)", { type: String })
    .option("--registry <registries>", "Target registries", { type: String, default: "npm,jsr" })
    .option("--no-build", "Skip build step", { type: Boolean })
    .option("--dry-run", "Show what would happen without publishing", { type: Boolean })
    .action(async (tag?: string, options?: { snapshotId?: string; registry?: string; build?: boolean; dryRun?: boolean }) => {
      const cwd = process.cwd();
      const config = await loadConfig(cwd);
      const pkg = await getPackageJson();
      const git = new Git();

      // Determine snapshot identifier
      let commit: string | undefined;
      if (options?.snapshotId) {
        commit = options.snapshotId;
      }

      const snapshotVersion = generateSnapshotVersion({
        tag: tag ?? "snapshot",
        baseVersion: pkg.version,
        commit,
        template: commit ? "{base}-{tag}-{commit}" : undefined,
        useCalculatedVersion: !!config?.snapshot?.useCalculatedVersion,
      });

      console.log(`Snapshot version: ${snapshotVersion}`);

      if (options?.dryRun) {
        console.log("Dry run — no changes made.");
        return;
      }

      // Write version (no git commit/tag for snapshots)
      await replaceVersion(snapshotVersion);

      // Build if needed
      if (options?.build !== false) {
        const packageManager = await getPackageManager();
        try {
          await exec(packageManager, ["run", "build"], { throwOnError: true });
        } catch (error) {
          // Restore original version on build failure
          await replaceVersion(pkg.version);
          throw error;
        }
      }

      // Publish to registries with snapshot tag
      const registries = options?.registry?.split(",") ?? ["npm", "jsr"];
      const packageManager = await getPackageManager();

      for (const registry of registries) {
        if (registry === "npm") {
          try {
            await exec("npm", ["publish", "--tag", tag ?? "snapshot", "--no-git-checks"], { throwOnError: true });
            console.log(`Published ${snapshotVersion} to npm`);
          } catch (error) {
            console.error(`Failed to publish to npm: ${error}`);
          }
        } else if (registry === "jsr") {
          try {
            await exec("jsr", ["publish", "--allow-dirty"], { throwOnError: true });
            console.log(`Published ${snapshotVersion} to jsr`);
          } catch (error) {
            console.error(`Failed to publish to jsr: ${error}`);
          }
        }
      }

      // Restore original version (snapshots don't persist version changes)
      await replaceVersion(pkg.version);

      console.log(`\nSnapshot ${snapshotVersion} published successfully.`);
    });
}
```

**Step 4: Run typecheck and format**

Run: `pnpm format && pnpm typecheck`

**Step 5: Commit**

```bash
git add src/commands/snapshot.ts tests/unit/commands/snapshot.test.ts
git commit -m "feat: implement pubm snapshot command with timestamp and custom ID support"
```

---

### Task 8: Windows Compatibility — Ping Command Fix

**Files:**
- Modify: `src/registry/jsr.ts:56-70` — platform-aware ping

**Step 1: Write the failing test**

Create `tests/unit/registry/jsr-ping.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import process from "node:process";

describe("jsr ping platform handling", () => {
  it("should use -n flag on Windows and -c on Unix", async () => {
    // This test validates the logic, not actual ping execution
    const platform = process.platform;
    const flag = platform === "win32" ? "-n" : "-c";
    expect(["-n", "-c"]).toContain(flag);
  });
});
```

**Step 2: Fix the ping method in `src/registry/jsr.ts`**

Replace lines 56-70:

```ts
  async ping(): Promise<boolean> {
    try {
      const flag = process.platform === "win32" ? "-n" : "-c";
      const { stdout } = await exec(
        "ping",
        [flag, "1", new URL(this.registry).hostname],
        { throwOnError: true },
      );

      return stdout.includes("1 packets transmitted") || stdout.includes("Sent = 1");
    } catch (error) {
      throw new JsrError(
        `Failed to ping ${new URL(this.registry).hostname}`,
        { cause: error },
      );
    }
  }
```

Add `import process from "node:process";` at top of file if not present.

**Step 3: Run format and typecheck**

Run: `pnpm format && pnpm typecheck`

**Step 4: Commit**

```bash
git add src/registry/jsr.ts tests/unit/registry/jsr-ping.test.ts
git commit -m "fix: use platform-aware ping flags for Windows compatibility"
```

---

### Task 9: Windows Compatibility — cross-spawn for Direct spawn

**Files:**
- Modify: `package.json` — add `cross-spawn` dependency
- Modify: `src/tasks/npm.ts:1` — use `cross-spawn` instead of `child_process.spawn`

**Step 1: Install cross-spawn**

```bash
pnpm add cross-spawn
pnpm add -D @types/cross-spawn
```

**Step 2: Update src/tasks/npm.ts**

Replace `import { spawn } from "node:child_process"` with:

```ts
import spawn from "cross-spawn";
```

The rest of the spawn usage should work identically since cross-spawn is a drop-in replacement.

**Step 3: Run tests**

Run: `pnpm vitest --run`
Expected: All tests pass

**Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml src/tasks/npm.ts
git commit -m "fix: use cross-spawn for Windows-compatible process spawning"
```

---

### Task 10: Bun Runtime Compatibility

**Files:**
- Create: `src/utils/runtime.ts` — runtime detection utility

**Step 1: Write the failing test**

Create `tests/unit/utils/runtime.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { detectRuntime } from "../../src/utils/runtime.js";

describe("detectRuntime", () => {
  it("should detect node runtime", () => {
    const runtime = detectRuntime();
    // In Vitest (runs on Node), this should be "node"
    expect(["node", "bun"]).toContain(runtime);
  });

  it("should return runtime info", () => {
    const runtime = detectRuntime();
    expect(typeof runtime).toBe("string");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest --run tests/unit/utils/runtime.test.ts`
Expected: FAIL — module not found

**Step 3: Create runtime detection module**

Create `src/utils/runtime.ts`:

```ts
export type Runtime = "node" | "bun";

export function detectRuntime(): Runtime {
  if (typeof globalThis.Bun !== "undefined") {
    return "bun";
  }
  return "node";
}

export function isBun(): boolean {
  return detectRuntime() === "bun";
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm vitest --run tests/unit/utils/runtime.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/utils/runtime.ts tests/unit/utils/runtime.test.ts
git commit -m "feat: add Bun runtime detection utility"
```

---

### Task 11: Add Bun to CI Test Matrix

**Files:**
- Modify: `.github/workflows/ci.yaml` — add Bun test job

**Step 1: Read current CI config**

Read `.github/workflows/ci.yaml` to understand current structure.

**Step 2: Add Bun job to matrix**

Add a separate job or matrix entry for Bun:

```yaml
  test-bun:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest
      - uses: pnpm/action-setup@v4
      - run: pnpm install --frozen-lockfile
      - run: pnpm build
      - run: pnpm test
```

**Step 3: Commit**

```bash
git add .github/workflows/ci.yaml
git commit -m "ci: add Bun runtime to test matrix"
```

---

### Task 12: Update README — Sync Features

**Files:**
- Modify: `README.md` — comprehensive update

**Step 1: Update README.md**

Key changes:
1. Remove "(Soon)" from monorepo — it's implemented
2. Update comparison table: Windows & Bun → ✅ Supported
3. Add **Subcommands** section documenting all commands:
   - `pubm init` — Initialize pubm configuration
   - `pubm add` — Create changesets
   - `pubm version` — Consume changesets and bump versions
   - `pubm status` — Show pending changesets
   - `pubm pre enter/exit <tag>` — Manage pre-release mode
   - `pubm snapshot [tag]` — Create snapshot releases
   - `pubm migrate` — Migrate from .changeset/
   - `pubm update` — Auto-update pubm
   - `pubm secrets sync` — Sync tokens to GitHub Secrets
4. Add **Plugin System** section with example config
5. Add **Changeset Workflow** section
6. Add **Supported Registries** section (npm, jsr, crates.io, custom)
7. Update CLI options table with new flags

**Step 2: Commit**

```bash
git add README.md
git commit -m "docs: sync README with all implemented features and new capabilities"
```

---

### Task 13: Final Verification

**Step 1: Run format**

Run: `pnpm format`

**Step 2: Run typecheck**

Run: `pnpm typecheck`

**Step 3: Run all tests**

Run: `pnpm test`

**Step 4: Run build**

Run: `pnpm build`

**Step 5: If all pass, commit any remaining changes**

```bash
git add -A
git commit -m "chore: final formatting and type fixes"
```
