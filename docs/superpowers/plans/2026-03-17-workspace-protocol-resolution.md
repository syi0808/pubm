# Workspace Protocol Resolution Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve `workspace:` protocol in package.json before npm publish, then restore after publish.

**Architecture:** New module `packages/core/src/monorepo/resolve-workspace.ts` provides workspace protocol resolution. The runner resolves before publish tasks, registers `addRollback` for failure restore, and adds an explicit restore task for the success path.

**Tech Stack:** TypeScript, Node.js fs, vitest, existing `detectWorkspace()` + `resolvePatterns()`

**Spec:** `docs/superpowers/specs/2026-03-17-workspace-protocol-resolution-design.md`

---

## File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `packages/core/src/monorepo/resolve-workspace.ts` | `resolveWorkspaceProtocol()`, `collectWorkspaceVersions()`, `resolveWorkspaceProtocolsInManifests()`, `restoreManifests()` |
| Create | `packages/core/tests/unit/monorepo/resolve-workspace.test.ts` | Unit tests |
| Modify | `packages/core/src/monorepo/discover.ts:50` | Export `resolvePatterns()` |
| Modify | `packages/core/src/monorepo/index.ts` | Re-export new functions |
| Modify | `packages/core/src/context.ts:62-75` | Add `workspaceBackups` to runtime type |
| Modify | `packages/core/src/tasks/runner.ts` | Resolve/restore around Publishing tasks |

---

### Task 1: `resolveWorkspaceProtocol()` + tests

**Files:**
- Create: `packages/core/src/monorepo/resolve-workspace.ts`
- Create: `packages/core/tests/unit/monorepo/resolve-workspace.test.ts`

- [ ] **Step 1: Write the full test file**

```typescript
// packages/core/tests/unit/monorepo/resolve-workspace.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const { originalStatSync } = vi.hoisted(() => {
  const fs = require("node:fs");
  return { originalStatSync: fs.statSync };
});

vi.mock("node:fs", async (importOriginal) => {
  const original = (await importOriginal()) as typeof import("node:fs");
  return {
    ...original,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    readdirSync: vi.fn(),
    statSync: vi.fn((...args: unknown[]) => {
      const p = String(args[0]);
      if (!p.includes("/mock-workspace")) {
        return originalStatSync(
          ...(args as Parameters<typeof originalStatSync>),
        );
      }
      return { isDirectory: () => true };
    }),
  };
});

vi.mock("../../../src/monorepo/workspace.js", () => ({
  detectWorkspace: vi.fn(),
}));

vi.mock("../../../src/monorepo/discover.js", () => ({
  resolvePatterns: vi.fn(),
}));

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { detectWorkspace } from "../../../src/monorepo/workspace.js";
import { resolvePatterns } from "../../../src/monorepo/discover.js";
import {
  collectWorkspaceVersions,
  resolveWorkspaceProtocol,
  resolveWorkspaceProtocolsInManifests,
  restoreManifests,
} from "../../../src/monorepo/resolve-workspace.js";

// ─── resolveWorkspaceProtocol ───

describe("resolveWorkspaceProtocol", () => {
  const version = "1.5.0";

  it("resolves workspace:* to exact version", () => {
    expect(resolveWorkspaceProtocol("workspace:*", version)).toBe("1.5.0");
  });

  it("resolves workspace:^ to caret range", () => {
    expect(resolveWorkspaceProtocol("workspace:^", version)).toBe("^1.5.0");
  });

  it("resolves workspace:~ to tilde range", () => {
    expect(resolveWorkspaceProtocol("workspace:~", version)).toBe("~1.5.0");
  });

  it("strips workspace: prefix from explicit caret range", () => {
    expect(resolveWorkspaceProtocol("workspace:^1.2.0", version)).toBe(
      "^1.2.0",
    );
  });

  it("strips workspace: prefix from explicit tilde range", () => {
    expect(resolveWorkspaceProtocol("workspace:~1.2.0", version)).toBe(
      "~1.2.0",
    );
  });

  it("strips workspace: prefix from explicit version", () => {
    expect(resolveWorkspaceProtocol("workspace:1.2.0", version)).toBe("1.2.0");
  });

  it("returns spec unchanged when no workspace: prefix", () => {
    expect(resolveWorkspaceProtocol("^1.0.0", version)).toBe("^1.0.0");
  });
});

// ─── collectWorkspaceVersions ───

describe("collectWorkspaceVersions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty map when no workspaces detected", () => {
    vi.mocked(detectWorkspace).mockReturnValue([]);
    const result = collectWorkspaceVersions("/mock-workspace");
    expect(result.size).toBe(0);
  });

  it("builds name→version map from workspace packages", () => {
    vi.mocked(detectWorkspace).mockReturnValue([
      { type: "bun", patterns: ["packages/*"] },
    ]);
    vi.mocked(resolvePatterns).mockReturnValue([
      "/mock-workspace/packages/core",
      "/mock-workspace/packages/cli",
    ]);
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockImplementation((filePath: any) => {
      if (String(filePath).includes("packages/core")) {
        return JSON.stringify({ name: "@pubm/core", version: "0.4.2" });
      }
      if (String(filePath).includes("packages/cli")) {
        return JSON.stringify({ name: "pubm", version: "0.4.2" });
      }
      return "{}";
    });

    const result = collectWorkspaceVersions("/mock-workspace");
    expect(result.get("@pubm/core")).toBe("0.4.2");
    expect(result.get("pubm")).toBe("0.4.2");
  });

  it("skips directories without package.json", () => {
    vi.mocked(detectWorkspace).mockReturnValue([
      { type: "bun", patterns: ["packages/*"] },
    ]);
    vi.mocked(resolvePatterns).mockReturnValue([
      "/mock-workspace/packages/empty",
    ]);
    vi.mocked(existsSync).mockReturnValue(false);

    const result = collectWorkspaceVersions("/mock-workspace");
    expect(result.size).toBe(0);
  });

  it("skips packages with missing name or version", () => {
    vi.mocked(detectWorkspace).mockReturnValue([
      { type: "bun", patterns: ["packages/*"] },
    ]);
    vi.mocked(resolvePatterns).mockReturnValue([
      "/mock-workspace/packages/broken",
    ]);
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({ name: "broken-pkg" }),
    );

    const result = collectWorkspaceVersions("/mock-workspace");
    expect(result.size).toBe(0);
  });
});

// ─── resolveWorkspaceProtocolsInManifests ───

describe("resolveWorkspaceProtocolsInManifests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("replaces workspace: specs in all dependency fields", () => {
    const manifest = {
      name: "pubm",
      version: "0.4.2",
      dependencies: { "@pubm/core": "workspace:*" },
      devDependencies: { "@pubm/utils": "workspace:^" },
      optionalDependencies: { "@pubm/darwin-arm64": "workspace:~" },
      peerDependencies: { "@pubm/peer": "workspace:^1.0.0" },
    };

    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(manifest, null, 2));

    const versions = new Map([
      ["@pubm/core", "0.4.2"],
      ["@pubm/utils", "0.4.2"],
      ["@pubm/darwin-arm64", "0.4.2"],
    ]);

    const backups = resolveWorkspaceProtocolsInManifests(
      ["/mock-workspace/packages/cli"],
      versions,
    );

    expect(backups.size).toBe(1);
    expect(vi.mocked(writeFileSync)).toHaveBeenCalledTimes(1);

    const writtenContent = JSON.parse(
      vi.mocked(writeFileSync).mock.calls[0][1] as string,
    );
    expect(writtenContent.dependencies["@pubm/core"]).toBe("0.4.2");
    expect(writtenContent.devDependencies["@pubm/utils"]).toBe("^0.4.2");
    expect(writtenContent.optionalDependencies["@pubm/darwin-arm64"]).toBe(
      "~0.4.2",
    );
    expect(writtenContent.peerDependencies["@pubm/peer"]).toBe("^1.0.0");
  });

  it("skips manifests with no workspace: dependencies", () => {
    const manifest = {
      name: "pubm",
      version: "0.4.2",
      dependencies: { commander: "^14.0.0" },
    };

    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(manifest, null, 2));

    const backups = resolveWorkspaceProtocolsInManifests(
      ["/mock-workspace/packages/cli"],
      new Map(),
    );

    expect(backups.size).toBe(0);
    expect(vi.mocked(writeFileSync)).not.toHaveBeenCalled();
  });

  it("throws when dynamic workspace: spec references unknown package", () => {
    const manifest = {
      name: "pubm",
      version: "0.4.2",
      dependencies: { "@pubm/unknown": "workspace:*" },
    };

    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(manifest, null, 2));

    expect(() =>
      resolveWorkspaceProtocolsInManifests(
        ["/mock-workspace/packages/cli"],
        new Map(),
      ),
    ).toThrow("@pubm/unknown");
  });

  it("allows static workspace: spec for unknown packages", () => {
    const manifest = {
      name: "pubm",
      version: "0.4.2",
      dependencies: { "@pubm/unknown": "workspace:^1.0.0" },
    };

    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(manifest, null, 2));

    const backups = resolveWorkspaceProtocolsInManifests(
      ["/mock-workspace/packages/cli"],
      new Map(),
    );

    expect(backups.size).toBe(1);
    const writtenContent = JSON.parse(
      vi.mocked(writeFileSync).mock.calls[0][1] as string,
    );
    expect(writtenContent.dependencies["@pubm/unknown"]).toBe("^1.0.0");
  });
});

// ─── restoreManifests ───

describe("restoreManifests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes original contents back to files", () => {
    const original =
      '{"name":"pubm","dependencies":{"@pubm/core":"workspace:*"}}';
    const backups = new Map([
      ["/mock-workspace/packages/cli/package.json", original],
    ]);

    restoreManifests(backups);

    expect(vi.mocked(writeFileSync)).toHaveBeenCalledWith(
      "/mock-workspace/packages/cli/package.json",
      original,
      "utf-8",
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/core && bun vitest --run tests/unit/monorepo/resolve-workspace.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Create the full implementation file**

```typescript
// packages/core/src/monorepo/resolve-workspace.ts
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { detectWorkspace } from "./workspace.js";
import { resolvePatterns } from "./discover.js";

const WORKSPACE_PREFIX = "workspace:";

const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
] as const;

/**
 * Resolve a single workspace: protocol specifier to a concrete version string.
 * Follows pnpm/yarn/bun publish resolution rules.
 */
export function resolveWorkspaceProtocol(
  spec: string,
  version: string,
): string {
  if (!spec.startsWith(WORKSPACE_PREFIX)) return spec;

  const range = spec.slice(WORKSPACE_PREFIX.length);

  switch (range) {
    case "*":
      return version;
    case "^":
      return `^${version}`;
    case "~":
      return `~${version}`;
    default:
      return range;
  }
}

/** Dynamic workspace specifiers that require sibling version lookup */
function isDynamicWorkspaceSpec(range: string): boolean {
  return range === "*" || range === "^" || range === "~";
}

/**
 * Build a Map<packageName, version> for all workspace packages.
 * Uses cwd-based workspace discovery, not pubm config.
 */
export function collectWorkspaceVersions(
  cwd: string,
): Map<string, string> {
  const versions = new Map<string, string>();
  const workspaces = detectWorkspace(cwd);

  if (workspaces.length === 0) return versions;

  for (const workspace of workspaces) {
    if (workspace.patterns.length === 0) continue;

    const dirs = resolvePatterns(cwd, workspace.patterns);

    for (const dir of dirs) {
      const pkgJsonPath = join(dir, "package.json");
      if (!existsSync(pkgJsonPath)) continue;

      try {
        const content = readFileSync(pkgJsonPath, "utf-8");
        const pkg = JSON.parse(content);

        if (
          typeof pkg.name === "string" &&
          pkg.name &&
          typeof pkg.version === "string" &&
          pkg.version
        ) {
          versions.set(pkg.name, pkg.version);
        }
      } catch {
        // Malformed package.json — skip
      }
    }
  }

  return versions;
}

/**
 * Resolve workspace: protocols in package.json files.
 * Returns a Map<filePath, originalContent> for restoration.
 */
export function resolveWorkspaceProtocolsInManifests(
  packagePaths: string[],
  workspaceVersions: Map<string, string>,
): Map<string, string> {
  const backups = new Map<string, string>();

  for (const pkgPath of packagePaths) {
    const manifestPath = join(pkgPath, "package.json");
    const original = readFileSync(manifestPath, "utf-8");
    const pkg = JSON.parse(original);

    let modified = false;

    for (const field of DEPENDENCY_FIELDS) {
      const deps = pkg[field] as Record<string, string> | undefined;
      if (!deps) continue;

      for (const [depName, spec] of Object.entries(deps)) {
        if (!spec.startsWith(WORKSPACE_PREFIX)) continue;

        const range = spec.slice(WORKSPACE_PREFIX.length);

        if (isDynamicWorkspaceSpec(range)) {
          const version = workspaceVersions.get(depName);
          if (!version) {
            throw new Error(
              `Cannot resolve "${spec}" for dependency "${depName}": package not found in workspace`,
            );
          }
          deps[depName] = resolveWorkspaceProtocol(spec, version);
        } else {
          deps[depName] = range;
        }

        modified = true;
      }
    }

    if (modified) {
      backups.set(manifestPath, original);
      writeFileSync(manifestPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf-8");
    }
  }

  return backups;
}

/**
 * Restore original package.json files from backups.
 */
export function restoreManifests(backups: Map<string, string>): void {
  for (const [filePath, content] of backups) {
    writeFileSync(filePath, content, "utf-8");
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/core && bun vitest --run tests/unit/monorepo/resolve-workspace.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```
feat(core): add workspace protocol resolution module
```

---

### Task 2: Export `resolvePatterns` + re-export from index

**Files:**
- Modify: `packages/core/src/monorepo/discover.ts:50`
- Modify: `packages/core/src/monorepo/index.ts`

- [ ] **Step 1: Export `resolvePatterns` in discover.ts**

In `packages/core/src/monorepo/discover.ts` line 50, change:

```typescript
function resolvePatterns(cwd: string, patterns: string[]): string[] {
```

to:

```typescript
export function resolvePatterns(cwd: string, patterns: string[]): string[] {
```

- [ ] **Step 2: Add re-exports to index.ts**

Add to `packages/core/src/monorepo/index.ts`:

```typescript
export {
  collectWorkspaceVersions,
  resolveWorkspaceProtocol,
  resolveWorkspaceProtocolsInManifests,
  restoreManifests,
} from "./resolve-workspace.js";
export { resolvePatterns } from "./discover.js";
```

- [ ] **Step 3: Run build + existing tests**

Run: `bun run build && cd packages/core && bun vitest --run tests/unit/monorepo/`
Expected: Build succeeds, all tests pass

- [ ] **Step 4: Commit**

```
refactor(core): export resolvePatterns and re-export workspace resolution
```

---

### Task 3: Add `workspaceBackups` to runtime context type

**Files:**
- Modify: `packages/core/src/context.ts:62-75`

- [ ] **Step 1: Add field to runtime type**

In `packages/core/src/context.ts`, add `workspaceBackups` to the `runtime` type (line ~74, before the closing `}`):

```typescript
    npmOtpPromise?: Promise<string>;
    workspaceBackups?: Map<string, string>;
  };
```

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: No errors

- [ ] **Step 3: Commit**

```
feat(core): add workspaceBackups to runtime context type
```

---

### Task 4: Runner integration — all Publishing locations

**Files:**
- Modify: `packages/core/src/tasks/runner.ts`

Strategy:
- **Resolve** at the start of each Publishing task callback (synchronous, before creating subtasks)
- **`addRollback`** registers manifest restore for failure path
- **Stash** backups on `ctx.runtime.workspaceBackups`
- **Explicit restore task** after each Publishing task for success path

- [ ] **Step 1: Add imports to runner.ts**

At the top of `packages/core/src/tasks/runner.ts`, add:

```typescript
import {
  collectWorkspaceVersions,
  resolveWorkspaceProtocolsInManifests,
  restoreManifests,
} from "../monorepo/resolve-workspace.js";
```

- [ ] **Step 2: Add helper function**

Add near the other helper functions (around `collectPublishTasks`):

```typescript
function resolveWorkspaceProtocols(ctx: PubmContext): void {
  const workspaceVersions = collectWorkspaceVersions(ctx.cwd);
  if (workspaceVersions.size === 0) return;

  const packagePaths = ctx.config.packages.map((pkg) =>
    path.resolve(ctx.cwd, pkg.path),
  );

  const backups = resolveWorkspaceProtocolsInManifests(
    packagePaths,
    workspaceVersions,
  );

  if (backups.size > 0) {
    ctx.runtime.workspaceBackups = backups;
    addRollback("Restore workspace protocols", () =>
      restoreManifests(backups),
    );
  }
}
```

Define the restore task factory for reuse:

```typescript
function createRestoreWorkspaceProtocolsTask(): ListrTask<PubmContext> {
  return {
    title: "Restoring workspace protocols",
    skip: (ctx) => !ctx.runtime.workspaceBackups?.size,
    task: (ctx) => {
      restoreManifests(ctx.runtime.workspaceBackups!);
      ctx.runtime.workspaceBackups = undefined;
    },
  };
}
```

- [ ] **Step 3: Modify CI mode Publishing (line ~638)**

Change the CI mode tasks array. Insert resolve call inside Publishing task, add restore task after it:

```typescript
// --- CI mode (ctx.options.ci === true) ---
{
  title: "Publishing",
  task: async (ctx, parentTask): Promise<Listr<PubmContext>> => {
    resolveWorkspaceProtocols(ctx);

    const publishTasks = await collectPublishTasks(ctx);
    parentTask.title = `Publishing (${countPublishTargets(ctx)} targets)`;
    parentTask.output = formatRegistryGroupSummary(
      "Concurrent publish tasks",
      ctx,
      true,
    );

    return parentTask.newListr(publishTasks, {
      concurrent: true,
    });
  },
},
createRestoreWorkspaceProtocolsTask(),
{
  title: "Creating GitHub Release",
  // ... (existing code unchanged)
```

- [ ] **Step 4: Modify publishOnly mode (line ~830)**

Change from single task to array:

```typescript
// --- publishOnly mode ---
// Before:
ctx.options.publishOnly
  ? {
      title: "Publishing",
      task: async (ctx, parentTask): Promise<Listr<PubmContext>> => { ... },
    }

// After:
ctx.options.publishOnly
  ? [
      {
        title: "Publishing",
        task: async (ctx, parentTask): Promise<Listr<PubmContext>> => {
          resolveWorkspaceProtocols(ctx);

          const publishTasks = await collectPublishTasks(ctx);
          parentTask.title = `Publishing (${countPublishTargets(ctx)} targets)`;
          parentTask.output = formatRegistryGroupSummary(
            "Concurrent publish tasks",
            ctx,
            true,
          );

          return parentTask.newListr(publishTasks, {
            concurrent: true,
          });
        },
      },
      createRestoreWorkspaceProtocolsTask(),
    ]
```

`createListr` accepts `ListrTask | ListrTask[]` (via `PubmListrTask` type), so this works.

- [ ] **Step 5: Modify normal mode — Publishing task (line ~1227)**

Insert resolve call, add restore task between Publishing and post-publish hooks:

```typescript
// --- Normal mode: Publishing ---
{
  skip: (ctx) =>
    !!ctx.options.skipPublish ||
    !!ctx.options.preview ||
    !!ctx.options.preflight,
  title: "Publishing",
  task: async (ctx, parentTask): Promise<Listr<PubmContext>> => {
    parentTask.output = "Running plugin beforePublish hooks...";
    await ctx.runtime.pluginRunner.runHook("beforePublish", ctx);

    resolveWorkspaceProtocols(ctx);

    const publishTasks = await collectPublishTasks(ctx);
    parentTask.title = `Publishing (${countPublishTargets(ctx)} targets)`;
    parentTask.output = formatRegistryGroupSummary(
      "Concurrent publish tasks",
      ctx,
      true,
    );

    return parentTask.newListr(publishTasks, {
      concurrent: true,
    });
  },
},
{
  skip: (ctx) =>
    !!ctx.options.skipPublish ||
    !!ctx.options.preview ||
    !!ctx.options.preflight ||
    !ctx.runtime.workspaceBackups?.size,
  title: "Restoring workspace protocols",
  task: (ctx) => {
    restoreManifests(ctx.runtime.workspaceBackups!);
    ctx.runtime.workspaceBackups = undefined;
  },
},
{
  skip: (ctx) =>
    !!ctx.options.skipPublish ||
    !!ctx.options.preview ||
    !!ctx.options.preflight,
  title: "Running post-publish hooks",
  // ... (existing code unchanged)
```

- [ ] **Step 6: Modify normal mode — dry-run / preflight (line ~1256)**

Insert resolve call, add restore task after dry-run:

```typescript
// --- Normal mode: Dry-run ---
{
  skip: !ctx.options.preflight,
  title: "Validating publish (dry-run)",
  task: async (ctx, parentTask): Promise<Listr<PubmContext>> => {
    resolveWorkspaceProtocols(ctx);

    const dryRunTasks = await collectDryRunPublishTasks(ctx);
    parentTask.title = `Validating publish (${countRegistryTargets(
      collectEcosystemRegistryGroups(ctx.config),
    )} targets)`;
    parentTask.output = formatRegistryGroupSummary(
      "Dry-run publish tasks",
      ctx,
    );

    return parentTask.newListr(dryRunTasks, {
      concurrent: true,
    });
  },
},
{
  skip: !ctx.options.preflight || !ctx.runtime.workspaceBackups?.size,
  title: "Restoring workspace protocols",
  task: (ctx) => {
    restoreManifests(ctx.runtime.workspaceBackups!);
    ctx.runtime.workspaceBackups = undefined;
  },
},
```

- [ ] **Step 7: Run typecheck**

Run: `bun run typecheck`
Expected: No type errors

- [ ] **Step 8: Run format**

Run: `bun run format`

- [ ] **Step 9: Run full test suite**

Run: `bun run test`
Expected: All PASS

- [ ] **Step 10: Commit**

```
feat(core): resolve workspace protocols before publish in all modes
```

---

### Task 5: Final verification

- [ ] **Step 1: Run full check suite**

Run: `bun run check && bun run typecheck && bun run test`
Expected: All pass

- [ ] **Step 2: Verify with dry-run**

Run: `cd packages/pubm && npm pack --dry-run 2>&1 | head -30`

Confirm the tarball listing looks correct (this doesn't test resolution itself, but ensures no breakage).
