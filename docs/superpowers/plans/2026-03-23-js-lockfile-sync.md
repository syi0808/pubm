# JS Lockfile Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sync JS lock files (bun, npm, pnpm, yarn) after version bumping in workspaces, matching existing Rust behavior.

**Architecture:** Implement `JsEcosystem.syncLockfile()` following the same upward-walk pattern as `RustEcosystem`. Add per-PM install command mapping to `package-manager.ts`. Add `lockfileSync` config option with tri-state control ("required"/"optional"/"skip"). Deduplicate Phase 3 in `writeVersionsForEcosystem()` so monorepos run install once.

**Tech Stack:** TypeScript, Bun, Vitest

---

### Task 1: Add install command mapping to `package-manager.ts`

**Files:**
- Modify: `packages/core/src/utils/package-manager.ts`
- Test: `packages/core/tests/unit/utils/package-manager.test.ts`

- [ ] **Step 1: Write failing tests for `getInstallCommand()`**

Add these tests to the existing test file:

```ts
import { getInstallCommand } from "../../../src/utils/package-manager.js";

describe("getInstallCommand", () => {
  it("returns bun install for bun", () => {
    expect(getInstallCommand("bun")).toEqual(["bun", "install"]);
  });

  it("returns npm install --package-lock-only for npm", () => {
    expect(getInstallCommand("npm")).toEqual([
      "npm",
      "install",
      "--package-lock-only",
    ]);
  });

  it("returns pnpm install --lockfile-only for pnpm", () => {
    expect(getInstallCommand("pnpm")).toEqual([
      "pnpm",
      "install",
      "--lockfile-only",
    ]);
  });

  it("returns yarn install for yarn without .yarnrc.yml", () => {
    expect(getInstallCommand("yarn", false)).toEqual(["yarn", "install"]);
  });

  it("returns yarn install --mode update-lockfile for yarn with .yarnrc.yml", () => {
    expect(getInstallCommand("yarn", true)).toEqual([
      "yarn",
      "install",
      "--mode",
      "update-lockfile",
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/core && bun vitest --run tests/unit/utils/package-manager.test.ts`
Expected: FAIL — `getInstallCommand` is not exported

- [ ] **Step 3: Implement `getInstallCommand()` and export `lockFiles`**

In `packages/core/src/utils/package-manager.ts`:

```ts
import { findOutFile } from "./package";

export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

export const lockFiles: Record<PackageManager, string[]> = {
  bun: ["bun.lock", "bun.lockb"],
  npm: ["package-lock.json", "npm-shrinkwrap.json"],
  pnpm: ["pnpm-lock.yaml"],
  yarn: ["yarn.lock"],
};

export function getInstallCommand(
  pm: PackageManager,
  isYarnBerry?: boolean,
): string[] {
  switch (pm) {
    case "bun":
      return ["bun", "install"];
    case "npm":
      return ["npm", "install", "--package-lock-only"];
    case "pnpm":
      return ["pnpm", "install", "--lockfile-only"];
    case "yarn":
      return isYarnBerry
        ? ["yarn", "install", "--mode", "update-lockfile"]
        : ["yarn", "install"];
  }
}

export async function getPackageManager(): Promise<PackageManager> {
  for (const [packageManager, files] of Object.entries(lockFiles)) {
    for (const file of files) {
      if (await findOutFile(file)) return packageManager as PackageManager;
    }
  }

  console.warn("No lock file found, defaulting to npm.");
  return "npm";
}
```

Key changes: export `PackageManager` type, rename `lockFile` → `lockFiles` (export), add `getInstallCommand()`. Update `getPackageManager()` to use renamed variable (avoid shadowing). Note: npm lock file order is kept as `package-lock.json` first to match existing behavior — the spec's precedence note applies to npm's internal resolution, not our detection order.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/core && bun vitest --run tests/unit/utils/package-manager.test.ts`
Expected: PASS

- [ ] **Step 5: Fix any imports of the renamed `lockFile` → `lockFiles`**

Search for imports from `package-manager.js` that reference the old name. Currently only internal usage within the same file — no external imports of the private `lockFile` constant. Verify with grep.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/utils/package-manager.ts packages/core/tests/unit/utils/package-manager.test.ts
git commit -m "feat(core): add getInstallCommand and export lockFiles map"
```

---

### Task 2: Add `lockfileSync` config option

**Files:**
- Modify: `packages/core/src/config/types.ts`
- Modify: `packages/core/src/config/defaults.ts`

- [ ] **Step 1: Add `lockfileSync` to `PubmConfig` interface**

In `packages/core/src/config/types.ts`, add to `PubmConfig`:

```ts
lockfileSync?: "required" | "optional" | "skip";
```

Add after the `rollbackStrategy` field (line 52).

- [ ] **Step 2: Add `lockfileSync` to `ResolvedPubmConfig`'s `Omit` exclusion list and add it back as optional**

The `ResolvedPubmConfig` uses `Required<Omit<PubmConfig, ...>>`. Since `lockfileSync` should default to `"optional"` at resolve time, it needs to be included in the `Required<>` wrapping. No special exclusion needed — it will automatically become required via the spread.

- [ ] **Step 3: Add default to `defaultConfig` in `defaults.ts`**

In `packages/core/src/config/defaults.ts`, add to `defaultConfig`:

```ts
lockfileSync: "optional" as const,
```

- [ ] **Step 4: Run typecheck to verify**

Run: `cd packages/core && bun run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/config/types.ts packages/core/src/config/defaults.ts
git commit -m "feat(core): add lockfileSync config option"
```

---

### Task 3: Update `Ecosystem.syncLockfile()` signature

**Files:**
- Modify: `packages/core/src/ecosystem/ecosystem.ts`
- Modify: `packages/core/src/ecosystem/rust.ts`
- Test: `packages/core/tests/unit/ecosystem/rust.test.ts`

- [ ] **Step 1: Write failing test for Rust syncLockfile skip mode**

Add to `packages/core/tests/unit/ecosystem/rust.test.ts` in the `syncLockfile` describe:

```ts
it("returns undefined immediately when mode is skip", async () => {
  const eco = new RustEcosystem(path.join("/workspace", "crates", "my-crate"));
  const result = await eco.syncLockfile("skip");
  expect(result).toBeUndefined();
  expect(mockedExec).not.toHaveBeenCalled();
  expect(mockedStat).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && bun vitest --run tests/unit/ecosystem/rust.test.ts`
Expected: FAIL — `syncLockfile` doesn't accept arguments (TypeScript may catch this at compile)

- [ ] **Step 3: Update base class signature**

In `packages/core/src/ecosystem/ecosystem.ts`, change:

```ts
async syncLockfile(
  _mode: "required" | "optional" | "skip" = "optional",
): Promise<string | undefined> {
  return undefined;
}
```

- [ ] **Step 4: Update `RustEcosystem.syncLockfile()`**

In `packages/core/src/ecosystem/rust.ts`, change:

```ts
async syncLockfile(
  mode: "required" | "optional" | "skip" = "optional",
): Promise<string | undefined> {
  if (mode === "skip") return undefined;

  const lockfilePath = await this.findLockfile();
  if (!lockfilePath) return undefined;

  try {
    const name = await this.packageName();
    await exec("cargo", ["update", "--package", name], {
      nodeOptions: { cwd: path.dirname(lockfilePath) },
    });
    return lockfilePath;
  } catch (error) {
    if (mode === "required") throw error;
    console.warn(
      `Warning: Failed to sync lockfile at ${lockfilePath}: ${error instanceof Error ? error.message : error}`,
    );
    return undefined;
  }
}
```

- [ ] **Step 5: Add test for Rust syncLockfile error handling in optional mode**

```ts
it("returns undefined and warns when install fails in optional mode", async () => {
  mockedStat.mockImplementation(async (filePath) => {
    const p = String(filePath);
    if (p.endsWith("Cargo.toml")) return { isFile: () => true } as any;
    if (p === path.join("/workspace", "Cargo.lock"))
      return { isFile: () => true } as any;
    throw new Error("ENOENT");
  });
  mockedReadFile.mockResolvedValue(CARGO_TOML as any);
  mockedExec.mockRejectedValue(new Error("cargo not found"));
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

  const eco = new RustEcosystem(path.join("/workspace", "crates", "my-crate"));
  const result = await eco.syncLockfile("optional");

  expect(result).toBeUndefined();
  expect(warnSpy).toHaveBeenCalled();
  warnSpy.mockRestore();
});

it("throws when install fails in required mode", async () => {
  mockedStat.mockImplementation(async (filePath) => {
    const p = String(filePath);
    if (p.endsWith("Cargo.toml")) return { isFile: () => true } as any;
    if (p === path.join("/workspace", "Cargo.lock"))
      return { isFile: () => true } as any;
    throw new Error("ENOENT");
  });
  mockedReadFile.mockResolvedValue(CARGO_TOML as any);
  mockedExec.mockRejectedValue(new Error("cargo not found"));

  const eco = new RustEcosystem(path.join("/workspace", "crates", "my-crate"));
  await expect(eco.syncLockfile("required")).rejects.toThrow("cargo not found");
});
```

- [ ] **Step 6: Run tests to verify all pass**

Run: `cd packages/core && bun vitest --run tests/unit/ecosystem/rust.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/ecosystem/ecosystem.ts packages/core/src/ecosystem/rust.ts packages/core/tests/unit/ecosystem/rust.test.ts
git commit -m "feat(core): add mode parameter to syncLockfile for skip/error handling"
```

---

### Task 4: Implement `JsEcosystem.syncLockfile()`

**Files:**
- Modify: `packages/core/src/ecosystem/js.ts`
- Test: `packages/core/tests/unit/ecosystem/js.test.ts`

- [ ] **Step 1: Write failing tests for `JsEcosystem.syncLockfile()`**

Add to `packages/core/tests/unit/ecosystem/js.test.ts`. Need to also mock `exec`:

At top of file, add the exec mock:

```ts
vi.mock("../../../src/utils/exec.js", () => ({
  exec: vi.fn(),
}));
```

Add import:

```ts
import { exec } from "../../../src/utils/exec.js";
const mockedExec = vi.mocked(exec);
```

Then add describe block:

```ts
describe("syncLockfile", () => {
  it("returns undefined when mode is skip", async () => {
    const eco = new JsEcosystem(pkgPath);
    const result = await eco.syncLockfile("skip");
    expect(result).toBeUndefined();
    expect(mockedExec).not.toHaveBeenCalled();
  });

  it("finds bun.lock walking upward and runs bun install", async () => {
    const lockPath = path.join("/workspace", "bun.lock");
    mockedStat.mockImplementation(async (filePath) => {
      if (String(filePath) === lockPath) return { isFile: () => true } as any;
      throw new Error("ENOENT");
    });
    mockedExec.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });

    const eco = new JsEcosystem(path.join("/workspace", "packages", "my-pkg"));
    const result = await eco.syncLockfile();

    expect(result).toBe(lockPath);
    expect(mockedExec).toHaveBeenCalledWith("bun", ["install"], {
      nodeOptions: { cwd: "/workspace" },
    });
  });

  it("finds package-lock.json and runs npm install --package-lock-only", async () => {
    const lockPath = path.join("/workspace", "package-lock.json");
    mockedStat.mockImplementation(async (filePath) => {
      if (String(filePath) === lockPath) return { isFile: () => true } as any;
      throw new Error("ENOENT");
    });
    mockedExec.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });

    const eco = new JsEcosystem(path.join("/workspace", "packages", "my-pkg"));
    const result = await eco.syncLockfile();

    expect(result).toBe(lockPath);
    expect(mockedExec).toHaveBeenCalledWith(
      "npm",
      ["install", "--package-lock-only"],
      { nodeOptions: { cwd: "/workspace" } },
    );
  });

  it("finds pnpm-lock.yaml and runs pnpm install --lockfile-only", async () => {
    const lockPath = path.join("/workspace", "pnpm-lock.yaml");
    mockedStat.mockImplementation(async (filePath) => {
      if (String(filePath) === lockPath) return { isFile: () => true } as any;
      throw new Error("ENOENT");
    });
    mockedExec.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });

    const eco = new JsEcosystem(path.join("/workspace", "packages", "my-pkg"));
    const result = await eco.syncLockfile();

    expect(result).toBe(lockPath);
    expect(mockedExec).toHaveBeenCalledWith(
      "pnpm",
      ["install", "--lockfile-only"],
      { nodeOptions: { cwd: "/workspace" } },
    );
  });

  it("detects yarn v1 (no .yarnrc.yml) and runs yarn install", async () => {
    const lockPath = path.join("/workspace", "yarn.lock");
    mockedStat.mockImplementation(async (filePath) => {
      const p = String(filePath);
      if (p === lockPath) return { isFile: () => true } as any;
      // .yarnrc.yml does not exist
      throw new Error("ENOENT");
    });
    mockedExec.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });

    const eco = new JsEcosystem(path.join("/workspace", "packages", "my-pkg"));
    const result = await eco.syncLockfile();

    expect(result).toBe(lockPath);
    expect(mockedExec).toHaveBeenCalledWith("yarn", ["install"], {
      nodeOptions: { cwd: "/workspace" },
    });
  });

  it("detects yarn v2+ (.yarnrc.yml exists) and runs yarn install --mode update-lockfile", async () => {
    const lockPath = path.join("/workspace", "yarn.lock");
    const yarnrcPath = path.join("/workspace", ".yarnrc.yml");
    mockedStat.mockImplementation(async (filePath) => {
      const p = String(filePath);
      if (p === lockPath || p === yarnrcPath)
        return { isFile: () => true } as any;
      throw new Error("ENOENT");
    });
    mockedExec.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });

    const eco = new JsEcosystem(path.join("/workspace", "packages", "my-pkg"));
    const result = await eco.syncLockfile();

    expect(result).toBe(lockPath);
    expect(mockedExec).toHaveBeenCalledWith(
      "yarn",
      ["install", "--mode", "update-lockfile"],
      { nodeOptions: { cwd: "/workspace" } },
    );
  });

  it("returns undefined when no lock file is found", async () => {
    mockedStat.mockRejectedValue(new Error("ENOENT"));

    const eco = new JsEcosystem(path.join("/workspace", "packages", "my-pkg"));
    const result = await eco.syncLockfile();

    expect(result).toBeUndefined();
    expect(mockedExec).not.toHaveBeenCalled();
  });

  it("warns and returns undefined on failure in optional mode", async () => {
    const lockPath = path.join("/workspace", "bun.lock");
    mockedStat.mockImplementation(async (filePath) => {
      if (String(filePath) === lockPath) return { isFile: () => true } as any;
      throw new Error("ENOENT");
    });
    mockedExec.mockRejectedValue(new Error("bun not found"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const eco = new JsEcosystem(path.join("/workspace", "packages", "my-pkg"));
    const result = await eco.syncLockfile("optional");

    expect(result).toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("throws on failure in required mode", async () => {
    const lockPath = path.join("/workspace", "bun.lock");
    mockedStat.mockImplementation(async (filePath) => {
      if (String(filePath) === lockPath) return { isFile: () => true } as any;
      throw new Error("ENOENT");
    });
    mockedExec.mockRejectedValue(new Error("bun not found"));

    const eco = new JsEcosystem(path.join("/workspace", "packages", "my-pkg"));
    await expect(eco.syncLockfile("required")).rejects.toThrow("bun not found");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/core && bun vitest --run tests/unit/ecosystem/js.test.ts`
Expected: FAIL — syncLockfile returns undefined (base class behavior)

- [ ] **Step 3: Implement `syncLockfile()` and `findLockfile()` in `JsEcosystem`**

In `packages/core/src/ecosystem/js.ts`, add imports and methods:

```ts
import { stat } from "node:fs/promises";
import { exec } from "../utils/exec.js";
import {
  type PackageManager,
  getInstallCommand,
  lockFiles,
} from "../utils/package-manager.js";

// Inside JsEcosystem class:

async syncLockfile(
  mode: "required" | "optional" | "skip" = "optional",
): Promise<string | undefined> {
  if (mode === "skip") return undefined;

  const found = await this.findLockfile();
  if (!found) return undefined;

  const { lockfilePath, packageManager } = found;
  const lockfileDir = path.dirname(lockfilePath);

  try {
    let isYarnBerry: boolean | undefined;
    if (packageManager === "yarn") {
      const yarnrcPath = path.join(lockfileDir, ".yarnrc.yml");
      try {
        isYarnBerry = (await stat(yarnrcPath)).isFile();
      } catch {
        isYarnBerry = false;
      }
    }

    const [cmd, ...args] = getInstallCommand(packageManager, isYarnBerry);
    await exec(cmd, args, { nodeOptions: { cwd: lockfileDir } });
    return lockfilePath;
  } catch (error) {
    if (mode === "required") throw error;
    console.warn(
      `Warning: Failed to sync lockfile at ${lockfilePath}: ${error instanceof Error ? error.message : error}`,
    );
    return undefined;
  }
}

/**
 * Walk from packagePath upward to find the first JS lock file.
 * In JS monorepos, the first lock file found ascending is the workspace root's.
 * Nested lock files below a workspace root indicate a separate project boundary,
 * not a workspace member.
 */
private async findLockfile(): Promise<
  { lockfilePath: string; packageManager: PackageManager } | undefined
> {
  let dir = this.packagePath;
  const { root } = path.parse(dir);

  while (dir !== root) {
    for (const [pm, files] of Object.entries(lockFiles)) {
      for (const file of files) {
        const candidate = path.join(dir, file);
        try {
          if ((await stat(candidate)).isFile()) {
            return {
              lockfilePath: candidate,
              packageManager: pm as PackageManager,
            };
          }
        } catch {}
      }
    }
    dir = path.dirname(dir);
  }

  return undefined;
}
```

Update the `node:fs/promises` import on line 2 to include `stat`:
```ts
import { readFile, stat, writeFile } from "node:fs/promises";
```

Update the `package-manager.js` import on line 8 to include new exports:
```ts
import {
  type PackageManager,
  getInstallCommand,
  getPackageManager,
  lockFiles,
} from "../utils/package-manager.js";
```

Add the `exec` import:
```ts
import { exec } from "../utils/exec.js";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/core && bun vitest --run tests/unit/ecosystem/js.test.ts`
Expected: PASS

- [ ] **Step 5: Run full test suite to check for regressions**

Run: `cd packages/core && bun vitest --run`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/ecosystem/js.ts packages/core/tests/unit/ecosystem/js.test.ts
git commit -m "feat(core): implement JsEcosystem.syncLockfile with PM-specific commands"
```

---

### Task 5: Deduplicate Phase 3 and pass `lockfileSync` config

**Files:**
- Modify: `packages/core/src/manifest/write-versions.ts`
- Modify: `packages/core/src/tasks/runner.ts:144-165`
- Modify: `packages/pubm/src/commands/version-cmd.ts:122`
- Test: `packages/core/tests/unit/manifest/write-versions.test.ts`

- [ ] **Step 1: Write failing test for Phase 3 deduplication**

Add to `packages/core/tests/unit/manifest/write-versions.test.ts` in the "Phase 3" describe:

```ts
it("deduplicates lockfile paths when multiple ecosystems return the same path", async () => {
  const sharedLockPath = "/workspace/bun.lock";
  const ecoA = createMockEcosystem("pkg-a", sharedLockPath);
  const ecoB = createMockEcosystem("pkg-b", sharedLockPath);

  const ecosystems = [
    { eco: ecoA, pkg: createMockPkg("pkg-a") },
    { eco: ecoB, pkg: createMockPkg("pkg-b") },
  ];
  const versions = new Map([
    ["/mock/pkg-a", "2.0.0"],
    ["/mock/pkg-b", "3.0.0"],
  ]);

  const result = await writeVersionsForEcosystem(ecosystems, versions);

  expect(result).toEqual([sharedLockPath]);
});
```

- [ ] **Step 2: Write test for lockfileSync parameter being passed through**

```ts
it("passes lockfileSync mode to syncLockfile", async () => {
  const eco = createMockEcosystem("pkg-a");
  const ecosystems = [{ eco, pkg: createMockPkg("pkg-a") }];
  const versions = new Map([["/mock/pkg-a", "2.0.0"]]);

  await writeVersionsForEcosystem(ecosystems, versions, "skip");

  expect(eco.syncLockfile).toHaveBeenCalledWith("skip");
});

it("defaults to undefined lockfileSync when not provided", async () => {
  const eco = createMockEcosystem("pkg-a");
  const ecosystems = [{ eco, pkg: createMockPkg("pkg-a") }];
  const versions = new Map([["/mock/pkg-a", "2.0.0"]]);

  await writeVersionsForEcosystem(ecosystems, versions);

  expect(eco.syncLockfile).toHaveBeenCalledWith(undefined);
});
```

- [ ] **Step 3: Run tests to verify failures**

Run: `cd packages/core && bun vitest --run tests/unit/manifest/write-versions.test.ts`
Expected: dedup test FAILS (duplicate entries), mode parameter tests FAIL (not passed)

- [ ] **Step 4: Update `writeVersionsForEcosystem()` — add parameter and deduplication**

In `packages/core/src/manifest/write-versions.ts`:

```ts
export async function writeVersionsForEcosystem(
  ecosystems: { eco: Ecosystem; pkg: ResolvedPackageConfig }[],
  versions: Map<string, string>,
  lockfileSync: "required" | "optional" | "skip" = "optional",
): Promise<string[]> {
  const modifiedFiles: string[] = [];

  // Phase 1: Write versions to manifests (path-keyed by pkg.path)
  for (const { eco, pkg } of ecosystems) {
    const version = versions.get(pkg.path);
    if (version) {
      await eco.writeVersion(version);
      // Invalidate ManifestReader cache
      for (const RegistryClass of eco.registryClasses()) {
        RegistryClass.reader.invalidate(eco.packagePath);
      }
    }
  }

  // Phase 2: Build name-keyed map for sibling dependency updates
  if (ecosystems.length > 1) {
    const nameKeyedVersions = new Map<string, string>();
    for (const { eco, pkg } of ecosystems) {
      const name = await eco.packageName();
      const version = versions.get(pkg.path);
      if (version) nameKeyedVersions.set(name, version);
    }
    await Promise.all(
      ecosystems.map(({ eco }) =>
        eco.updateSiblingDependencyVersions(nameKeyedVersions),
      ),
    );
  }

  // Phase 3: Sync lockfiles (deduplicated)
  const syncedLockfiles = new Set<string>();
  for (const { eco } of ecosystems) {
    const lockfilePath = await eco.syncLockfile(lockfileSync);
    if (lockfilePath && !syncedLockfiles.has(lockfilePath)) {
      syncedLockfiles.add(lockfilePath);
      modifiedFiles.push(lockfilePath);
    }
  }

  return modifiedFiles;
}
```

- [ ] **Step 5: Update `runner.ts` call site**

In `packages/core/src/tasks/runner.ts` line 157, change:

```ts
const lockfileChanges = await writeVersionsForEcosystem(
  ecosystems,
  versions,
  ctx.config.lockfileSync,
);
```

- [ ] **Step 6: Update `version-cmd.ts` call site**

In `packages/pubm/src/commands/version-cmd.ts` line 122, change:

```ts
await writeVersionsForEcosystem(ecosystems, versions, config.lockfileSync);
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd packages/core && bun vitest --run tests/unit/manifest/write-versions.test.ts`
Expected: PASS

- [ ] **Step 8: Run full project typecheck and tests**

Run: `bun run typecheck && bun run test`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/manifest/write-versions.ts packages/core/src/tasks/runner.ts packages/pubm/src/commands/version-cmd.ts packages/core/tests/unit/manifest/write-versions.test.ts
git commit -m "feat(core): deduplicate Phase 3 lockfile sync and pass lockfileSync config"
```

---

### Task 6: Final verification and coverage

**Files:**
- All modified files from previous tasks

- [ ] **Step 1: Run format check and fix**

Run: `bun run format`
Expected: All files formatted

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 3: Run full test suite**

Run: `bun run test`
Expected: PASS

- [ ] **Step 4: Run coverage**

Run: `bun run coverage`
Expected: PASS — thresholds met. If `package-manager.ts` or `js.ts` coverage thresholds need updating (increase only), update `vitest.config.mts`.

- [ ] **Step 5: Create changeset**

```bash
bunx pubm add --packages packages/core --bump minor --message "Add lockfileSync config option and JS lockfile sync on version bump"
```

- [ ] **Step 6: Commit changeset and any remaining fixes**

```bash
git add .changeset/ && git commit -m "chore: add changeset for JS lockfile sync"
```
