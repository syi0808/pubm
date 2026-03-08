# Already-Published Package Handling Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** When a specific version is already published on a registry, warn and skip instead of failing, so the pipeline continues normally.

**Architecture:** Add `isVersionPublished(version)` to each registry class for pre-check. In each publish/dry-run task, check before publishing and skip with warning if already published. Catch "already exists" errors as fallback for race conditions.

**Tech Stack:** TypeScript, listr2, fetch API, vitest

---

### Task 1: Add `isVersionPublished(version)` to Registry base class

**Files:**
- Modify: `src/registry/registry.ts:6-25`

**Step 1: Write the failing test**

Create: `tests/unit/registry/version-published.test.ts`

```typescript
import { describe, expect, it, vi } from "vitest";
import { NpmRegistry } from "../../../src/registry/npm.js";
import { JsrRegisry } from "../../../src/registry/jsr.js";
import { CratesRegistry } from "../../../src/registry/crates.js";

describe("isVersionPublished", () => {
  describe("NpmRegistry", () => {
    it("returns true when version exists (HTTP 200)", async () => {
      const npm = new NpmRegistry("test-package");
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(null, { status: 200 }),
      );

      expect(await npm.isVersionPublished("1.0.0")).toBe(true);
      expect(fetch).toHaveBeenCalledWith(
        "https://registry.npmjs.org/test-package/1.0.0",
      );
    });

    it("returns false when version does not exist (HTTP 404)", async () => {
      const npm = new NpmRegistry("test-package");
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(null, { status: 404 }),
      );

      expect(await npm.isVersionPublished("1.0.0")).toBe(false);
    });

    it("throws on network error", async () => {
      const npm = new NpmRegistry("test-package");
      vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(
        new Error("network error"),
      );

      await expect(npm.isVersionPublished("1.0.0")).rejects.toThrow();
    });
  });

  describe("CratesRegistry", () => {
    it("returns true when version exists (HTTP 200)", async () => {
      const crates = new CratesRegistry("test-crate");
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(null, { status: 200 }),
      );

      expect(await crates.isVersionPublished("1.0.0")).toBe(true);
      expect(fetch).toHaveBeenCalledWith(
        "https://crates.io/api/v1/crates/test-crate/1.0.0",
        expect.objectContaining({ headers: expect.any(Object) }),
      );
    });

    it("returns false when version does not exist (HTTP 404)", async () => {
      const crates = new CratesRegistry("test-crate");
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(null, { status: 404 }),
      );

      expect(await crates.isVersionPublished("1.0.0")).toBe(false);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/registry/version-published.test.ts`
Expected: FAIL — `isVersionPublished` is not a function

**Step 3: Add abstract method to Registry base class and implement in each registry**

In `src/registry/registry.ts`, add to the abstract class:
```typescript
abstract isVersionPublished(version: string): Promise<boolean>;
```

In `src/registry/npm.ts`, add method:
```typescript
async isVersionPublished(version: string): Promise<boolean> {
  try {
    const response = await fetch(
      `${this.registry}/${this.packageName}/${version}`,
    );
    return response.status === 200;
  } catch (error) {
    throw new NpmError(
      `Failed to fetch \`${this.registry}/${this.packageName}/${version}\``,
      { cause: error },
    );
  }
}
```

In `src/registry/jsr.ts`, add method to `JsrRegisry`:
```typescript
async isVersionPublished(version: string): Promise<boolean> {
  try {
    const [scope, name] = getScopeAndName(this.packageName);
    const response = await fetch(
      `${this.registry}/@${scope}/${name}/${version}`,
    );
    return response.status === 200;
  } catch (error) {
    throw new JsrError(
      `Failed to fetch \`${this.registry}/${this.packageName}/${version}\``,
      { cause: error },
    );
  }
}
```

In `src/registry/crates.ts`, add method:
```typescript
async isVersionPublished(version: string): Promise<boolean> {
  try {
    const response = await fetch(
      `${this.registry}/api/v1/crates/${this.packageName}/${version}`,
      { headers: this.headers },
    );
    return response.ok;
  } catch (error) {
    throw new CratesError(
      `Failed to check version ${version} for '${this.packageName}' on crates.io`,
      { cause: error },
    );
  }
}
```

`CustomRegistry` inherits from `NpmRegistry`, so it automatically gets `isVersionPublished` — the `this.registry` property is already overridden per instance.

**Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/registry/version-published.test.ts`
Expected: PASS

**Step 5: Commit**

```
git add src/registry/registry.ts src/registry/npm.ts src/registry/jsr.ts src/registry/crates.ts tests/unit/registry/version-published.test.ts
git commit -m "feat: add isVersionPublished method to registry classes"
```

---

### Task 2: Add already-published skip logic to npm publish task

**Files:**
- Modify: `src/tasks/npm.ts:111-169`

**Step 1: Write the failing test**

Create: `tests/unit/tasks/npm-already-published.test.ts`

```typescript
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../../src/registry/npm.js", () => ({
  npmRegistry: vi.fn(),
}));

import { npmRegistry } from "../../../src/registry/npm.js";
import { npmPublishTasks } from "../../../src/tasks/npm.js";

const mockedNpmRegistry = vi.mocked(npmRegistry);

describe("npmPublishTasks — already published", () => {
  const mockTask = {
    output: "",
    title: "Running npm publish",
    skip: vi.fn(),
    prompt: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockTask.output = "";
    mockTask.title = "Running npm publish";
  });

  it("skips publish when version is already published", async () => {
    const mockNpm = {
      isVersionPublished: vi.fn().mockResolvedValue(true),
      packageName: "test-package",
    };
    mockedNpmRegistry.mockResolvedValue(mockNpm as any);

    const ctx = { promptEnabled: true, version: "1.0.0" } as any;

    await (npmPublishTasks as any).task(ctx, mockTask);

    expect(mockNpm.isVersionPublished).toHaveBeenCalledWith("1.0.0");
    expect(mockTask.skip).toHaveBeenCalled();
    expect(mockTask.title).toContain("already published");
  });

  it("proceeds with publish when version is not published", async () => {
    const mockNpm = {
      isVersionPublished: vi.fn().mockResolvedValue(false),
      publish: vi.fn().mockResolvedValue(true),
      packageName: "test-package",
    };
    mockedNpmRegistry.mockResolvedValue(mockNpm as any);

    const ctx = { promptEnabled: true, version: "1.0.0" } as any;

    await (npmPublishTasks as any).task(ctx, mockTask);

    expect(mockNpm.publish).toHaveBeenCalled();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/tasks/npm-already-published.test.ts`
Expected: FAIL — no `isVersionPublished` call in task

**Step 3: Add pre-check and error catch to npm publish task**

In `src/tasks/npm.ts`, modify `npmPublishTasks.task` to add pre-check at the start and wrap publish errors:

```typescript
export const npmPublishTasks: ListrTask<Ctx> = {
  title: "Running npm publish",
  skip: (ctx) => !!ctx.preview,
  task: async (ctx, task): Promise<void> => {
    const npm = await npmRegistry();

    // Pre-check: skip if version already published
    if (await npm.isVersionPublished(ctx.version)) {
      task.title = `[SKIPPED] npm: v${ctx.version} already published`;
      task.output = `⚠ ${npm.packageName}@${ctx.version} is already published on npm`;
      return task.skip();
    }

    task.output = "Publishing on npm...";

    try {
      // ... existing publish logic (unchanged) ...
    } catch (error) {
      // Fallback: catch "already published" errors
      if (
        error instanceof Error &&
        (error.message.includes("cannot publish over the previously published") ||
          error.message.includes("You cannot publish over the previously published"))
      ) {
        task.title = `[SKIPPED] npm: v${ctx.version} already published`;
        task.output = `⚠ ${npm.packageName}@${ctx.version} is already published on npm`;
        return task.skip();
      }
      throw error;
    }
  },
};
```

**Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/tasks/npm-already-published.test.ts`
Expected: PASS

**Step 5: Commit**

```
git add src/tasks/npm.ts tests/unit/tasks/npm-already-published.test.ts
git commit -m "feat: skip npm publish with warning when version already published"
```

---

### Task 3: Add already-published skip logic to jsr publish task

**Files:**
- Modify: `src/tasks/jsr.ts:246-307`

**Step 1: Write the failing test**

Create: `tests/unit/tasks/jsr-already-published.test.ts`

```typescript
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../../src/registry/jsr.js", () => ({
  jsrRegistry: vi.fn(),
  JsrClient: { token: "fake-token" },
}));

import { jsrRegistry } from "../../../src/registry/jsr.js";
import { jsrPublishTasks } from "../../../src/tasks/jsr.js";

const mockedJsrRegistry = vi.mocked(jsrRegistry);

describe("jsrPublishTasks — already published", () => {
  const mockTask = {
    output: "",
    title: "Running jsr publish",
    skip: vi.fn(),
    prompt: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockTask.output = "";
    mockTask.title = "Running jsr publish";
  });

  it("skips publish when version is already published", async () => {
    const mockJsr = {
      isVersionPublished: vi.fn().mockResolvedValue(true),
      packageName: "@scope/test",
    };
    mockedJsrRegistry.mockResolvedValue(mockJsr as any);

    const ctx = { promptEnabled: true, version: "1.0.0" } as any;

    await (jsrPublishTasks as any).task(ctx, mockTask);

    expect(mockJsr.isVersionPublished).toHaveBeenCalledWith("1.0.0");
    expect(mockTask.skip).toHaveBeenCalled();
    expect(mockTask.title).toContain("already published");
  });

  it("proceeds with publish when version is not published", async () => {
    const mockJsr = {
      isVersionPublished: vi.fn().mockResolvedValue(false),
      publish: vi.fn().mockResolvedValue(true),
      packageName: "@scope/test",
    };
    mockedJsrRegistry.mockResolvedValue(mockJsr as any);

    const ctx = { promptEnabled: true, version: "1.0.0" } as any;

    await (jsrPublishTasks as any).task(ctx, mockTask);

    expect(mockJsr.publish).toHaveBeenCalled();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/tasks/jsr-already-published.test.ts`
Expected: FAIL

**Step 3: Add pre-check and error catch to jsr publish task**

In `src/tasks/jsr.ts`, modify `jsrPublishTasks.task`:

```typescript
export const jsrPublishTasks: ListrTask<Ctx> = {
  title: "Running jsr publish",
  task: async (ctx, task): Promise<void> => {
    const jsr = await jsrRegistry();

    // Pre-check: skip if version already published
    if (await jsr.isVersionPublished(ctx.version)) {
      task.title = `[SKIPPED] jsr: v${ctx.version} already published`;
      task.output = `⚠ ${jsr.packageName}@${ctx.version} is already published on jsr`;
      return task.skip();
    }

    task.output = "Publishing on jsr...";

    // ... existing publish logic ...
    // Wrap in try/catch for fallback:
    try {
      // existing code
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("already published")
      ) {
        task.title = `[SKIPPED] jsr: v${ctx.version} already published`;
        task.output = `⚠ ${jsr.packageName}@${ctx.version} is already published on jsr`;
        return task.skip();
      }
      throw error;
    }
  },
};
```

**Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/tasks/jsr-already-published.test.ts`
Expected: PASS

**Step 5: Commit**

```
git add src/tasks/jsr.ts tests/unit/tasks/jsr-already-published.test.ts
git commit -m "feat: skip jsr publish with warning when version already published"
```

---

### Task 4: Add already-published skip logic to crates publish task

**Files:**
- Modify: `src/tasks/crates.ts:46-57`

**Step 1: Write the failing test**

Create: `tests/unit/tasks/crates-already-published.test.ts`

```typescript
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../../src/registry/crates.js", () => ({
  CratesRegistry: vi.fn().mockImplementation((name: string) => ({
    packageName: name,
    isVersionPublished: vi.fn(),
    publish: vi.fn(),
  })),
}));

vi.mock("../../../src/ecosystem/rust.js", () => ({
  RustEcosystem: vi.fn().mockImplementation(() => ({
    packageName: vi.fn().mockResolvedValue("test-crate"),
  })),
}));

import { CratesRegistry } from "../../../src/registry/crates.js";
import { createCratesPublishTask } from "../../../src/tasks/crates.js";

describe("cratesPublishTask — already published", () => {
  const mockTask = {
    output: "",
    title: "",
    skip: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockTask.output = "";
    mockTask.title = "";
  });

  it("skips publish when version is already published", async () => {
    const mockRegistry = {
      packageName: "test-crate",
      isVersionPublished: vi.fn().mockResolvedValue(true),
      publish: vi.fn(),
    };
    vi.mocked(CratesRegistry).mockImplementation(() => mockRegistry as any);

    const task = createCratesPublishTask();
    const ctx = { version: "1.0.0" } as any;

    await (task as any).task(ctx, mockTask);

    expect(mockRegistry.isVersionPublished).toHaveBeenCalledWith("1.0.0");
    expect(mockTask.skip).toHaveBeenCalled();
    expect(mockTask.title).toContain("already published");
  });

  it("proceeds with publish when version is not published", async () => {
    const mockRegistry = {
      packageName: "test-crate",
      isVersionPublished: vi.fn().mockResolvedValue(false),
      publish: vi.fn().mockResolvedValue(true),
    };
    vi.mocked(CratesRegistry).mockImplementation(() => mockRegistry as any);

    const task = createCratesPublishTask();
    const ctx = { version: "1.0.0" } as any;

    await (task as any).task(ctx, mockTask);

    expect(mockRegistry.publish).toHaveBeenCalled();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/tasks/crates-already-published.test.ts`
Expected: FAIL

**Step 3: Add pre-check and error catch to crates publish task**

In `src/tasks/crates.ts`, modify `createCratesPublishTask`:

```typescript
export function createCratesPublishTask(packagePath?: string): ListrTask<Ctx> {
  const label = packagePath ? ` (${packagePath})` : "";
  return {
    title: `Publishing to crates.io${label}`,
    task: async (ctx, task): Promise<void> => {
      const packageName = await getCrateName(packagePath);
      const registry = new CratesRegistry(packageName);

      // Pre-check: skip if version already published
      if (await registry.isVersionPublished(ctx.version)) {
        task.title = `[SKIPPED] crates.io${label}: v${ctx.version} already published`;
        task.output = `⚠ ${packageName}@${ctx.version} is already published on crates.io`;
        return task.skip();
      }

      try {
        await registry.publish(packagePath);
      } catch (error) {
        // Fallback: catch "already uploaded" errors
        if (
          error instanceof Error &&
          error.message.includes("is already uploaded")
        ) {
          task.title = `[SKIPPED] crates.io${label}: v${ctx.version} already published`;
          task.output = `⚠ ${packageName}@${ctx.version} is already published on crates.io`;
          return task.skip();
        }
        throw error;
      }
    },
  };
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/tasks/crates-already-published.test.ts`
Expected: PASS

**Step 5: Commit**

```
git add src/tasks/crates.ts tests/unit/tasks/crates-already-published.test.ts
git commit -m "feat: skip crates publish with warning when version already published"
```

---

### Task 5: Add already-published skip logic to dry-run publish tasks

**Files:**
- Modify: `src/tasks/dry-run-publish.ts:52-72, 101-140`

**Step 1: Write the failing test**

Create: `tests/unit/tasks/dry-run-already-published.test.ts`

```typescript
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../../src/registry/npm.js", () => ({
  npmRegistry: vi.fn(),
}));

vi.mock("../../../src/registry/jsr.js", () => ({
  jsrRegistry: vi.fn(),
  JsrClient: { token: "fake-token" },
}));

vi.mock("../../../src/registry/crates.js", () => ({
  CratesRegistry: vi.fn(),
}));

vi.mock("../../../src/ecosystem/rust.js", () => ({
  RustEcosystem: vi.fn().mockImplementation(() => ({
    packageName: vi.fn().mockResolvedValue("test-crate"),
    dependencies: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock("../../../src/utils/db.js", () => ({
  Db: vi.fn().mockImplementation(() => ({
    get: vi.fn(),
    set: vi.fn(),
  })),
}));

import { npmRegistry } from "../../../src/registry/npm.js";
import { jsrRegistry } from "../../../src/registry/jsr.js";
import { CratesRegistry } from "../../../src/registry/crates.js";
import {
  npmDryRunPublishTask,
  jsrDryRunPublishTask,
  createCratesDryRunPublishTask,
} from "../../../src/tasks/dry-run-publish.js";

describe("dry-run publish — already published", () => {
  const mockTask = {
    output: "",
    title: "",
    skip: vi.fn(),
    prompt: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockTask.output = "";
    mockTask.title = "";
  });

  describe("npm", () => {
    it("skips dry-run when version already published", async () => {
      const mockNpm = {
        isVersionPublished: vi.fn().mockResolvedValue(true),
        dryRunPublish: vi.fn(),
        packageName: "test-package",
      };
      vi.mocked(npmRegistry).mockResolvedValue(mockNpm as any);

      const ctx = { version: "1.0.0" } as any;
      await (npmDryRunPublishTask as any).task(ctx, mockTask);

      expect(mockNpm.isVersionPublished).toHaveBeenCalledWith("1.0.0");
      expect(mockTask.skip).toHaveBeenCalled();
      expect(mockNpm.dryRunPublish).not.toHaveBeenCalled();
    });
  });

  describe("jsr", () => {
    it("skips dry-run when version already published", async () => {
      const mockJsr = {
        isVersionPublished: vi.fn().mockResolvedValue(true),
        dryRunPublish: vi.fn(),
        packageName: "@scope/test",
      };
      vi.mocked(jsrRegistry).mockResolvedValue(mockJsr as any);

      const ctx = { version: "1.0.0" } as any;
      await (jsrDryRunPublishTask as any).task(ctx, mockTask);

      expect(mockJsr.isVersionPublished).toHaveBeenCalledWith("1.0.0");
      expect(mockTask.skip).toHaveBeenCalled();
      expect(mockJsr.dryRunPublish).not.toHaveBeenCalled();
    });
  });

  describe("crates", () => {
    it("skips dry-run when version already published", async () => {
      const mockRegistry = {
        isVersionPublished: vi.fn().mockResolvedValue(true),
        dryRunPublish: vi.fn(),
        packageName: "test-crate",
      };
      vi.mocked(CratesRegistry).mockImplementation(
        () => mockRegistry as any,
      );

      const task = createCratesDryRunPublishTask();
      const ctx = { version: "1.0.0" } as any;
      await (task as any).task(ctx, mockTask);

      expect(mockRegistry.isVersionPublished).toHaveBeenCalledWith("1.0.0");
      expect(mockTask.skip).toHaveBeenCalled();
      expect(mockRegistry.dryRunPublish).not.toHaveBeenCalled();
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/tasks/dry-run-already-published.test.ts`
Expected: FAIL

**Step 3: Add pre-check to each dry-run task**

In `src/tasks/dry-run-publish.ts`:

For `npmDryRunPublishTask`:
```typescript
export const npmDryRunPublishTask: ListrTask<Ctx> = {
  title: "Dry-run npm publish",
  task: async (ctx, task): Promise<void> => {
    const npm = await npmRegistry();

    if (await npm.isVersionPublished(ctx.version)) {
      task.title = `[SKIPPED] Dry-run npm publish: v${ctx.version} already published`;
      task.output = `⚠ ${npm.packageName}@${ctx.version} is already published on npm`;
      return task.skip();
    }

    task.output = "Running npm publish --dry-run...";
    await withTokenRetry("npm", task, async () => {
      await npm.dryRunPublish();
    });
  },
};
```

For `jsrDryRunPublishTask`:
```typescript
export const jsrDryRunPublishTask: ListrTask<Ctx> = {
  title: "Dry-run jsr publish",
  task: async (ctx, task): Promise<void> => {
    const jsr = await jsrRegistry();

    if (await jsr.isVersionPublished(ctx.version)) {
      task.title = `[SKIPPED] Dry-run jsr publish: v${ctx.version} already published`;
      task.output = `⚠ ${jsr.packageName}@${ctx.version} is already published on jsr`;
      return task.skip();
    }

    task.output = "Running jsr publish --dry-run...";
    await withTokenRetry("jsr", task, async () => {
      await jsr.dryRunPublish();
    });
  },
};
```

For `createCratesDryRunPublishTask`: add pre-check before the existing sibling check:
```typescript
// At the start of the task function, before sibling check:
const packageName = await getCrateName(packagePath);
const registry = new CratesRegistry(packageName);

if (await registry.isVersionPublished(ctx.version)) {
  task.title = `[SKIPPED] Dry-run crates.io publish${label}: v${ctx.version} already published`;
  task.output = `⚠ ${packageName}@${ctx.version} is already published on crates.io`;
  return task.skip();
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/tasks/dry-run-already-published.test.ts`
Expected: PASS

**Step 5: Commit**

```
git add src/tasks/dry-run-publish.ts tests/unit/tasks/dry-run-already-published.test.ts
git commit -m "feat: skip dry-run publish with warning when version already published"
```

---

### Task 6: Run full test suite, lint, and typecheck

**Step 1: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS — no type errors

**Step 2: Run lint**

Run: `pnpm check`
Expected: PASS — no lint errors (fix with `pnpm format` if needed)

**Step 3: Run full test suite**

Run: `pnpm test`
Expected: All tests pass, including existing tests

**Step 4: Commit any fixes**

If any fixes were needed:
```
git add -A
git commit -m "fix: address lint/type issues from already-published handling"
```
