# Package-Level Task Policy Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** npm/jsr 패키지 수준 태스크가 `packagePath`를 필수로 받아 모노레포에서 올바르게 동작하도록 수정

**Architecture:** 기존 crates의 factory 패턴(`createCratesPublishTask(packagePath)`)을 npm/jsr에 적용. `collectPublishTasks`/`collectDryRunPublishTasks`에서 모든 레지스트리가 패키지별 서브태스크를 생성하도록 통합. `process.cwd()` fallback을 제거하여 동일한 버그 재발 방지.

**Tech Stack:** TypeScript, vitest, listr2, bun

**Spec:** `docs/superpowers/specs/2026-03-15-package-level-task-policy-design.md`

**Pre-commit checklist (모든 커밋 전):**
```bash
bun run format && bun run typecheck && bun run test
```

---

## Chunk 1: Registry Factory 필수화 + 유틸 분리

### Task 1: installGlobally를 독립 유틸로 분리

**Files:**
- Create: `packages/core/src/utils/npm-install.ts`
- Modify: `packages/core/src/registry/npm.ts:273-283` (installGlobally 메서드 삭제)
- Modify: `packages/core/src/registry/jsr.ts:232-236` (checkAvailability 내 호출 수정)

- [ ] **Step 1: Create `utils/npm-install.ts`**

```typescript
// packages/core/src/utils/npm-install.ts
import { exec } from "./exec.js";

export async function npmInstallGlobally(packageName: string): Promise<void> {
  await exec("npm", ["install", "-g", packageName], { throwOnError: true });
}
```

- [ ] **Step 2: Update `registry/jsr.ts` checkAvailability to use the new util**

In `packages/core/src/registry/jsr.ts`, replace lines 232-236:

```typescript
// Before
const { npmPackageRegistry } = await import("./npm.js");
const npm = await npmPackageRegistry();
await npm.installGlobally("jsr");

// After
const { npmInstallGlobally } = await import("../utils/npm-install.js");
await npmInstallGlobally("jsr");
```

- [ ] **Step 3: Delete `installGlobally` method from `NpmPackageRegistry`**

In `packages/core/src/registry/npm.ts`, delete the `installGlobally` method (lines 273-283).

- [ ] **Step 4: Update `packages/core/tests/unit/registry/npm.test.ts`**

Delete the `installGlobally` test block (lines 172-193). Also update the `npm(args)` test (lines 150-163) which uses `installGlobally` indirectly — replace it with a test that uses another public method like `userName()`:

```typescript
describe("npm(args)", () => {
  it("calls exec with npm and returns stdout", async () => {
    mockStdout("test-user");
    const result = await registry.userName();
    expect(mockedExec).toHaveBeenCalledWith(
      "npm",
      expect.arrayContaining(["whoami"]),
      expect.any(Object),
    );
    expect(result).toBe("test-user");
  });

  it("throws when exec rejects", async () => {
    mockedExec.mockRejectedValue(new Error("fatal error"));
    await expect(registry.userName()).rejects.toThrow();
  });
});
```

- [ ] **Step 5: Run typecheck**

Run: `cd packages/core && bunx tsc --noEmit`
Expected: PASS (no references to `installGlobally` remain)

- [ ] **Step 6: Run tests**

Run: `cd packages/core && bun vitest --run`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/utils/npm-install.ts packages/core/src/registry/npm.ts packages/core/src/registry/jsr.ts packages/core/tests/unit/registry/npm.test.ts
git commit -m "refactor(core): extract installGlobally to standalone utility"
```

### Task 2: `npmPackageRegistry` / `jsrPackageRegistry` / `customPackageRegistry` — packagePath 필수화

**Files:**
- Modify: `packages/core/src/registry/npm.ts:328-337`
- Modify: `packages/core/src/registry/jsr.ts:499-508`
- Modify: `packages/core/src/registry/custom-registry.ts:16-26`
- Test: `packages/core/tests/unit/registry/npm.test.ts`
- Test: `packages/core/tests/unit/registry/jsr.test.ts`
- Test: `packages/core/tests/unit/registry/custom-registry.test.ts`

- [ ] **Step 1: Make `npmPackageRegistry` require `packagePath`**

In `packages/core/src/registry/npm.ts`, change:

```typescript
// Before
export async function npmPackageRegistry(
  packagePath?: string,
): Promise<NpmPackageRegistry> {
  if (packagePath) {
    const manifest = await NpmPackageRegistry.reader.read(packagePath);
    return new NpmPackageRegistry(manifest.name);
  }
  const manifest = await NpmPackageRegistry.reader.read(process.cwd());
  return new NpmPackageRegistry(manifest.name);
}

// After
export async function npmPackageRegistry(
  packagePath: string,
): Promise<NpmPackageRegistry> {
  const manifest = await NpmPackageRegistry.reader.read(packagePath);
  return new NpmPackageRegistry(manifest.name);
}
```

- [ ] **Step 2: Make `jsrPackageRegistry` require `packagePath`**

Same pattern in `packages/core/src/registry/jsr.ts`.

```typescript
// After
export async function jsrPackageRegistry(
  packagePath: string,
): Promise<JsrPackageRegistry> {
  const manifest = await JsrPackageRegistry.reader.read(packagePath);
  return new JsrPackageRegistry(manifest.name);
}
```

- [ ] **Step 3: Make `customPackageRegistry` require `packagePath`**

In `packages/core/src/registry/custom-registry.ts`:

```typescript
// After
export async function customPackageRegistry(
  packagePath: string,
  registryUrl?: string,
): Promise<CustomPackageRegistry> {
  const manifest = await NpmPackageRegistry.reader.read(packagePath);
  return new CustomPackageRegistry(manifest.name, registryUrl);
}
```

Remove the `import process from "node:process";` at the top since it's no longer needed.

- [ ] **Step 4: Run typecheck to find all broken callers**

Run: `cd packages/core && bunx tsc --noEmit 2>&1 | head -50`
Expected: FAIL — compilation errors at all call sites that don't pass `packagePath`. These are the callers we'll fix in subsequent tasks. Note them down but don't fix yet (except tests).

- [ ] **Step 5: Fix registry test files to pass packagePath in factory calls**

In `packages/core/tests/unit/registry/npm.test.ts`, `jsr.test.ts`, `custom-registry.test.ts`: any test calling `npmPackageRegistry()` / `jsrPackageRegistry()` / `customPackageRegistry()` without args should pass a fixture path like `"packages/core/tests/fixtures/basic"`.

- [ ] **Step 6: Run registry tests**

Run: `cd packages/core && bun vitest --run tests/unit/registry/`
Expected: PASS

- [ ] **Step 7: Commit (tests may still fail in task files — that's expected, we'll fix in next tasks)**

```bash
git add packages/core/src/registry/npm.ts packages/core/src/registry/jsr.ts packages/core/src/registry/custom-registry.ts packages/core/tests/unit/registry/
git commit -m "refactor(core): make packagePath required in registry factory functions"
```

## Chunk 2: Task 파일 factory 패턴 변경

### Task 3: `dry-run-publish.ts` — static 상수를 factory 함수로 변경

**Files:**
- Modify: `packages/core/src/tasks/dry-run-publish.ts:53-87`
- Test: `packages/core/tests/unit/tasks/dry-run-publish.test.ts`
- Test: `packages/core/tests/unit/tasks/dry-run-already-published.test.ts`

- [ ] **Step 1: Update tests for the new factory pattern**

In `packages/core/tests/unit/tasks/dry-run-publish.test.ts`, change imports and tests:

```typescript
// Change import
import {
  cratesDryRunPublishTask,
  createCratesDryRunPublishTask,
  createJsrDryRunPublishTask,  // new
  createNpmDryRunPublishTask,  // new
} from "../../../src/tasks/dry-run-publish.js";

// Update tests
describe("createNpmDryRunPublishTask", () => {
  it("uses packagePath as initial title", () => {
    const task = createNpmDryRunPublishTask("packages/core");
    expect(task.title).toBe("packages/core");
  });

  it("passes packagePath to npmPackageRegistry", async () => {
    const mockDryRun = vi.fn().mockResolvedValue(undefined);
    mockedNpmRegistry.mockResolvedValue({
      packageName: "@pubm/core",
      dryRunPublish: mockDryRun,
      isVersionPublished: vi.fn().mockResolvedValue(false),
    } as any);

    const mockTask = { output: "", title: "" };
    const task = createNpmDryRunPublishTask("packages/core");
    await (task as any).task({ runtime: {} }, mockTask);
    expect(mockedNpmRegistry).toHaveBeenCalledWith("packages/core");
    expect(mockTask.title).toBe("@pubm/core");
    expect(mockDryRun).toHaveBeenCalled();
  });
});

describe("createJsrDryRunPublishTask", () => {
  it("uses packagePath as initial title", () => {
    const task = createJsrDryRunPublishTask("packages/core");
    expect(task.title).toBe("packages/core");
  });

  it("passes packagePath to jsrPackageRegistry", async () => {
    const mockDryRun = vi.fn().mockResolvedValue(undefined);
    mockedJsrRegistry.mockResolvedValue({
      packageName: "@pubm/core",
      dryRunPublish: mockDryRun,
      isVersionPublished: vi.fn().mockResolvedValue(false),
    } as any);

    const mockTask = { output: "", title: "" };
    const task = createJsrDryRunPublishTask("packages/core");
    await (task as any).task({ runtime: {} }, mockTask);
    expect(mockedJsrRegistry).toHaveBeenCalledWith("packages/core");
    expect(mockTask.title).toBe("@pubm/core");
    expect(mockDryRun).toHaveBeenCalled();
  });
});
```

Also update `withTokenRetry` tests to use `createNpmDryRunPublishTask("packages/core")` and `createJsrDryRunPublishTask("packages/core")` instead of the old static constants.

Update `dry-run-already-published.test.ts` similarly: replace `npmDryRunPublishTask` → `createNpmDryRunPublishTask("packages/core")`, etc.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/core && bun vitest --run tests/unit/tasks/dry-run-publish.test.ts`
Expected: FAIL (old imports don't exist yet)

- [ ] **Step 3: Implement factory functions in `dry-run-publish.ts`**

Replace the static constants with factory functions. Also update `withTokenRetry` to use a shared promise pattern on `ctx` to prevent concurrent prompt duplication:

```typescript
// withTokenRetry에 ctx 파라미터 추가
async function withTokenRetry(
  registryKey: string,
  ctx: PubmContext,
  task: any,
  action: () => Promise<void>,
): Promise<void> {
  try {
    await action();
  } catch (error) {
    if (!isAuthError(error)) throw error;

    const descriptor = registryCatalog.get(registryKey);
    if (!descriptor) throw error;
    const config = descriptor.tokenConfig;

    // Shared promise: 첫 번째 태스크만 프롬프트, 나머지는 await
    const retryKey = `_tokenRetry_${registryKey}` as keyof typeof ctx.runtime;
    if (!(ctx.runtime as any)[retryKey]) {
      (ctx.runtime as any)[retryKey] = (async () => {
        task.output = `Auth failed. Re-enter ${config.promptLabel}`;
        const newToken: string = await task.prompt(ListrEnquirerPromptAdapter).run({
          type: "password",
          message: `Re-enter ${config.promptLabel}`,
        });
        new SecureStore().set(config.dbKey, newToken);
        process.env[config.envVar] = newToken;
        return newToken;
      })();
    }

    await (ctx.runtime as any)[retryKey];
    await action();
  }
}

export function createNpmDryRunPublishTask(
  packagePath: string,
): ListrTask<PubmContext> {
  return {
    title: packagePath,
    task: async (ctx, task): Promise<void> => {
      const npm = await npmPackageRegistry(packagePath);
      task.title = npm.packageName;

      if (await npm.isVersionPublished(ctx.runtime.version!)) {
        task.title = `[SKIPPED] Dry-run npm publish: v${ctx.runtime.version} already published`;
        task.output = `⚠ ${npm.packageName}@${ctx.runtime.version} is already published on npm`;
        return task.skip();
      }

      task.output = "Running npm publish --dry-run...";
      await withTokenRetry("npm", ctx, task, async () => {
        await npm.dryRunPublish();
      });
    },
  };
}

export function createJsrDryRunPublishTask(
  packagePath: string,
): ListrTask<PubmContext> {
  return {
    title: packagePath,
    task: async (ctx, task): Promise<void> => {
      const jsr = await jsrPackageRegistry(packagePath);
      task.title = jsr.packageName;

      if (await jsr.isVersionPublished(ctx.runtime.version!)) {
        task.title = `[SKIPPED] Dry-run jsr publish: v${ctx.runtime.version} already published`;
        task.output = `⚠ ${jsr.packageName}@${ctx.runtime.version} is already published on jsr`;
        return task.skip();
      }

      task.output = "Running jsr publish --dry-run...";
      await withTokenRetry("jsr", ctx, task, async () => {
        await jsr.dryRunPublish();
      });
    },
  };
}
```

Remove the old `npmDryRunPublishTask` and `jsrDryRunPublishTask` static constants.

- [ ] **Step 4: Run tests**

Run: `cd packages/core && bun vitest --run tests/unit/tasks/dry-run-publish.test.ts tests/unit/tasks/dry-run-already-published.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/tasks/dry-run-publish.ts packages/core/tests/unit/tasks/dry-run-publish.test.ts packages/core/tests/unit/tasks/dry-run-already-published.test.ts
git commit -m "refactor(core): convert npm/jsr dry-run tasks to factory functions with packagePath"
```

### Task 4: `tasks/npm.ts` — dead code 삭제 + factory 함수 변환 + OTP concurrent 핸들링

패키지별 서브태스크가 `concurrent: true`로 실행되므로, OTP 프롬프트가 동시에 여러 개 뜨는 것을 방지해야 한다. 첫 번째 EOTP를 만난 태스크가 프롬프트를 소유하고, 나머지는 같은 promise를 await하여 OTP를 공유한다.

**Files:**
- Modify: `packages/core/src/tasks/npm.ts`
- Modify: `packages/core/src/context.ts` (runtime에 OTP 필드 추가)
- Test: `packages/core/tests/unit/tasks/npm.test.ts`
- Test: `packages/core/tests/unit/tasks/npm-already-published.test.ts`

- [ ] **Step 1: Add OTP fields to `PubmContext.runtime`**

In `packages/core/src/context.ts`, add to the `runtime` interface:

```typescript
runtime: {
  // ... existing fields ...
  npmOtp?: string;
  npmOtpPromise?: Promise<string>;
};
```

- [ ] **Step 2: Update tests**

In `npm.test.ts`:
- Remove all tests for `npmAvailableCheckTasks` (dead code 삭제)
- Change import: `npmPublishTasks` → `createNpmPublishTask`
- Update all test calls to use `createNpmPublishTask("packages/core")`
- Add assertion that `npmPackageRegistry` is called with the packagePath
- Add test for OTP sharing: two tasks with same ctx, first prompts, second reuses

In `npm-already-published.test.ts`:
- Same import/usage changes

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd packages/core && bun vitest --run tests/unit/tasks/npm.test.ts`
Expected: FAIL

- [ ] **Step 4: Implement changes in `tasks/npm.ts`**

- Delete `npmAvailableCheckTasks` export and all its logic
- Convert `npmPublishTasks` to `createNpmPublishTask(packagePath: string)` with OTP sharing:

```typescript
export function createNpmPublishTask(
  packagePath: string,
): ListrTask<PubmContext> {
  return {
    title: packagePath,
    skip: (ctx) => !!ctx.options.preview,
    task: async (ctx, task): Promise<void> => {
      const npm = await npmPackageRegistry(packagePath);
      task.title = npm.packageName;

      if (await npm.isVersionPublished(ctx.runtime.version!)) {
        task.title = `[SKIPPED] npm: v${ctx.runtime.version} already published`;
        task.output = `⚠ ${npm.packageName}@${ctx.runtime.version} is already published on npm`;
        return task.skip();
      }

      task.output = "Publishing on npm...";

      try {
        if (ctx.runtime.promptEnabled) {
          // Try with cached OTP first (from another concurrent task)
          let result = await npm.publish(ctx.runtime.npmOtp);

          if (!result) {
            // EOTP — need OTP. Use shared promise to avoid multiple prompts.
            if (!ctx.runtime.npmOtpPromise) {
              ctx.runtime.npmOtpPromise = (async () => {
                task.title = `${npm.packageName} (OTP code needed)`;
                const maxAttempts = 3;

                for (let attempt = 1; attempt <= maxAttempts; attempt++) {
                  const otp = await task
                    .prompt(ListrEnquirerPromptAdapter)
                    .run<string>({
                      type: "password",
                      message: `npm OTP code${attempt > 1 ? ` (attempt ${attempt}/${maxAttempts})` : ""}`,
                    });

                  const success = await npm.publish(otp);
                  if (success) {
                    ctx.runtime.npmOtp = otp;
                    task.title = `${npm.packageName} (2FA passed)`;
                    return otp;
                  }

                  if (attempt < maxAttempts) {
                    task.output = "2FA failed. Please try again.";
                  }
                }

                throw new NpmAvailableError(
                  "OTP verification failed after 3 attempts.",
                );
              })();
            }

            const otp = await ctx.runtime.npmOtpPromise;
            // Other concurrent tasks: publish with shared OTP
            if (!result) {
              result = await npm.publish(otp);
            }
          }
        } else {
          // CI mode — existing logic unchanged
          const npmTokenEnv = process.env.NODE_AUTH_TOKEN;

          if (!npmTokenEnv) {
            throw new NpmAvailableError(
              "NODE_AUTH_TOKEN not found in environment variables.",
            );
          }

          const result = await npm.publishProvenance();

          if (!result) {
            throw new NpmAvailableError(
              `In CI environment, publishing with 2FA is not allowed.`,
            );
          }
        }
      } catch (error) {
        if (
          error instanceof Error &&
          (error.message.includes("cannot publish over the previously published") ||
            error.message.includes("You cannot publish over the previously published"))
        ) {
          task.title = `[SKIPPED] npm: v${ctx.runtime.version} already published`;
          return task.skip();
        }
        throw error;
      }
    },
  };
}
```

- [ ] **Step 5: Run tests**

Run: `cd packages/core && bun vitest --run tests/unit/tasks/npm.test.ts tests/unit/tasks/npm-already-published.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/context.ts packages/core/src/tasks/npm.ts packages/core/tests/unit/tasks/npm.test.ts packages/core/tests/unit/tasks/npm-already-published.test.ts
git commit -m "refactor(core): convert npmPublishTasks to factory with concurrent OTP sharing"
```

### Task 5: `tasks/jsr.ts` — dead code 삭제 + factory 함수 변환

**Files:**
- Modify: `packages/core/src/tasks/jsr.ts`
- Test: `packages/core/tests/unit/tasks/jsr.test.ts`
- Test: `packages/core/tests/unit/tasks/jsr-already-published.test.ts`

- [ ] **Step 1: Update tests**

In `jsr.test.ts`:
- Remove all tests for `jsrAvailableCheckTasks` (dead code 삭제)
- Change import: `jsrPublishTasks` → `createJsrPublishTask`
- Update test calls to use `createJsrPublishTask("packages/core")`
- Add assertion that `jsrPackageRegistry` is called with the packagePath

In `jsr-already-published.test.ts`: same changes.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/core && bun vitest --run tests/unit/tasks/jsr.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement changes in `tasks/jsr.ts`**

- Delete `jsrAvailableCheckTasks` export and all its logic (including the `npmPackageRegistry` import if no longer needed)
- Convert `jsrPublishTasks` to `createJsrPublishTask(packagePath: string)`:

```typescript
export function createJsrPublishTask(
  packagePath: string,
): ListrTask<PubmContext> {
  return {
    title: packagePath,
    task: async (ctx, task): Promise<void> => {
      const jsr = await jsrPackageRegistry(packagePath);
      task.title = jsr.packageName;

      // ... rest of existing publish logic unchanged
    },
  };
}
```

- [ ] **Step 4: Run tests**

Run: `cd packages/core && bun vitest --run tests/unit/tasks/jsr.test.ts tests/unit/tasks/jsr-already-published.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/tasks/jsr.ts packages/core/tests/unit/tasks/jsr.test.ts packages/core/tests/unit/tasks/jsr-already-published.test.ts
git commit -m "refactor(core): convert jsrPublishTasks to factory, delete jsrAvailableCheckTasks dead code"
```

## Chunk 3: Runner + Catalog + 나머지 수정

### Task 6: `runner.ts` — taskMap + collect 함수 통합

**Files:**
- Modify: `packages/core/src/tasks/runner.ts:42-241`
- Test: `packages/core/tests/unit/tasks/runner.test.ts`
- Test: `packages/core/tests/unit/tasks/runner-coverage.test.ts`

- [ ] **Step 1: Update imports in `runner.ts`**

```typescript
// Before
import {
  createCratesDryRunPublishTask,
  jsrDryRunPublishTask,
  npmDryRunPublishTask,
} from "./dry-run-publish.js";
import { jsrPublishTasks } from "./jsr.js";
import { npmPublishTasks } from "./npm.js";

// After
import {
  createCratesDryRunPublishTask,
  createJsrDryRunPublishTask,
  createNpmDryRunPublishTask,
} from "./dry-run-publish.js";
import { createJsrPublishTask } from "./jsr.js";
import { createNpmPublishTask } from "./npm.js";
```

- [ ] **Step 2: Update `publishTaskMap`**

```typescript
const publishTaskMap: Record<
  string,
  (packagePath: string) => ListrTask<PubmContext>
> = {
  npm: (p) => createNpmPublishTask(p),
  jsr: (p) => createJsrPublishTask(p),
  crates: (p) => createCratesPublishTask(p),
};
```

- [ ] **Step 3: Update `dryRunTaskMap`**

```typescript
const dryRunTaskMap: Record<
  string,
  (packagePath: string, siblingNames?: string[]) => ListrTask<PubmContext>
> = {
  npm: (p) => createNpmDryRunPublishTask(p),
  jsr: (p) => createJsrDryRunPublishTask(p),
  crates: (p, siblingNames) => createCratesDryRunPublishTask(p, siblingNames),
};
```

- [ ] **Step 4: Update `createPublishTaskForPath` and `createDryRunTaskForPath` — make `packagePath` required**

```typescript
function createPublishTaskForPath(
  registryKey: string,
  packagePath: string,
): ListrTask<PubmContext> {
  const factory = publishTaskMap[registryKey];
  if (!factory)
    return { title: `Publish to ${registryKey}`, task: async () => {} };
  return factory(packagePath);
}
```

Same for `createDryRunTaskForPath`.

- [ ] **Step 5: Unify `collectPublishTasks` — remove concurrent early-return**

Replace the concurrent/sequential branching with unified logic:

```typescript
async function collectPublishTasks(ctx: PubmContext) {
  const groups = collectEcosystemRegistryGroups(ctx.config);

  const ecosystemTasks = await Promise.all(
    groups.map(async (group) => {
      const registryTasks = await Promise.all(
        group.registries.map(async ({ registry, packagePaths }) => {
          const descriptor = registryCatalog.get(registry);
          if (!descriptor)
            return { title: registry, task: async () => {} };

          const paths = descriptor.orderPackages
            ? await descriptor.orderPackages(packagePaths)
            : packagePaths;

          return {
            title: `Running ${descriptor.label} publish`,
            task: (_ctx: PubmContext, task: NewListrParentTask<PubmContext>) =>
              task.newListr(
                paths.map((p) => createPublishTaskForPath(registry, p)),
                { concurrent: descriptor.concurrentPublish },
              ),
          };
        }),
      );

      return {
        title: ecosystemLabel(group.ecosystem),
        task: (_ctx: PubmContext, task: NewListrParentTask<PubmContext>) =>
          task.newListr(registryTasks, { concurrent: true }),
      };
    }),
  );

  return [...ecosystemTasks, ...pluginPublishTasks(ctx)];
}
```

- [ ] **Step 6: Unify `collectDryRunPublishTasks` — same pattern**

Same restructuring: remove the `if (descriptor.concurrentPublish)` early-return, always create per-package sub-tasks with `{ concurrent: descriptor.concurrentPublish }`.

- [ ] **Step 7: Update runner tests**

In `runner.test.ts` and `runner-coverage.test.ts`:
- Update mocks to match new factory imports (`createNpmPublishTask`, `createJsrPublishTask`, `createNpmDryRunPublishTask`, `createJsrDryRunPublishTask`)
- Update any assertions about task structure to expect per-package sub-tasks

- [ ] **Step 8: Run tests**

Run: `cd packages/core && bun vitest --run tests/unit/tasks/runner.test.ts tests/unit/tasks/runner-coverage.test.ts`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/tasks/runner.ts packages/core/tests/unit/tasks/runner.test.ts packages/core/tests/unit/tasks/runner-coverage.test.ts
git commit -m "refactor(core): unify publish/dry-run task collection with per-package sub-tasks"
```

### Task 7: `catalog.ts` resolveDisplayName + `required-missing-information.ts` dist-tag 수정

**Files:**
- Modify: `packages/core/src/registry/catalog.ts:88-121`
- Modify: `packages/core/src/tasks/required-missing-information.ts:188-195`
- Test: `packages/core/tests/unit/registry/catalog.test.ts`
- Test: `packages/core/tests/unit/tasks/required-missing-information.test.ts`

- [ ] **Step 1: Update `resolveDisplayName` for npm in `catalog.ts`**

```typescript
// Before (line 88-95)
resolveDisplayName: async () => {
  try {
    const manifest = await NpmPackageRegistry.reader.read(process.cwd());
    return manifest.name ? [manifest.name] : [];
  } catch {
    return [];
  }
},

// After
resolveDisplayName: async (ctx) => {
  return (
    ctx.packages
      ?.filter((pkg) => pkg.registries?.includes("npm"))
      .map((pkg) => pkg.name) ?? []
  );
},
```

- [ ] **Step 2: Update `resolveDisplayName` for jsr in `catalog.ts`**

Same pattern with `.includes("jsr")`.

- [ ] **Step 3: Remove unused imports in `catalog.ts`**

Remove `import process from "node:process";` and `JsrPackageRegistry` import if only used in `resolveDisplayName`.

- [ ] **Step 4: Update dist-tag query in `required-missing-information.ts`**

```typescript
// Before (lines 188-195)
const npm = await npmPackageRegistry();
const jsr = await jsrPackageRegistry();
const distTags = [
  ...new Set(
    (await Promise.all([npm.distTags(), jsr.distTags()])).flat(),
  ),
].filter((tag) => tag !== defaultOptions.tag);

// After
const registryKeys = new Set(
  ctx.config.packages.flatMap((pkg) => pkg.registries ?? []),
);
const firstPkgPath = ctx.config.packages[0]?.path;
const allDistTags: string[] = [];

for (const key of registryKeys) {
  const descriptor = registryCatalog.get(key);
  if (!descriptor) continue;
  try {
    const registry = await descriptor.factory(firstPkgPath);
    allDistTags.push(...(await registry.distTags()));
  } catch {
    // Registry not yet published — ignore
  }
}

const distTags = [...new Set(allDistTags)]
  .filter((tag) => tag !== defaultOptions.tag);
```

Add import for `registryCatalog` at top of `required-missing-information.ts`. Remove unused `npmPackageRegistry` and `jsrPackageRegistry` imports.

- [ ] **Step 5: Update tests**

In `catalog.test.ts`: update `resolveDisplayName` tests to pass `ctx` with `packages` array.

In `required-missing-information.test.ts`: update the dist-tag test to mock `registryCatalog.get` and `descriptor.factory` instead of `npmPackageRegistry`/`jsrPackageRegistry`.

- [ ] **Step 6: Run tests**

Run: `cd packages/core && bun vitest --run tests/unit/registry/catalog.test.ts tests/unit/tasks/required-missing-information.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/registry/catalog.ts packages/core/src/tasks/required-missing-information.ts packages/core/tests/unit/registry/catalog.test.ts packages/core/tests/unit/tasks/required-missing-information.test.ts
git commit -m "refactor(core): update resolveDisplayName and dist-tag query to use ctx.packages"
```

### Task 8: Final verification

- [ ] **Step 1: Run format**

Run: `bun run format`

- [ ] **Step 2: Run full typecheck**

Run: `bun run typecheck`
Expected: PASS — no remaining `process.cwd()` fallback in registry factories

- [ ] **Step 3: Run full test suite**

Run: `bun run test`
Expected: PASS — all tests green

- [ ] **Step 4: Run coverage**

Run: `bun run coverage`
Expected: PASS — coverage thresholds met (95% lines/functions/statements, 90% branches)

- [ ] **Step 5: Commit any format fixes**

```bash
git add -A
git commit -m "chore: format fixes"
```
