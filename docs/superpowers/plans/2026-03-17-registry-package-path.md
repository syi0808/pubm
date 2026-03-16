# Registry packagePath 전파 구현 계획

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `PackageRegistry` 서브클래스가 `packagePath`를 보유하여 publish 계열 명령이 올바른 패키지 디렉토리에서 실행되도록 수정

**Architecture:** `PackageRegistry` 생성자에 `packagePath` 필수 파라미터 추가. 모든 서브클래스(npm, jsr, crates, custom)의 publish/dryRunPublish 메서드에서 `this.packagePath`를 cwd로 사용. factory 함수와 task 레이어도 일관되게 수정.

**Tech Stack:** TypeScript, Bun, Vitest

**Spec:** `docs/superpowers/specs/2026-03-17-registry-package-path-design.md`

---

## Chunk 1: 기반 클래스 + npm/custom 레지스트리

### Task 1: Cargo.toml fixture 추가

**Files:**
- Create: `packages/core/tests/fixtures/basic/Cargo.toml`

- [ ] **Step 1: fixture 파일 생성**

```toml
[package]
name = "test-crate"
version = "1.0.0"
edition = "2021"
```

- [ ] **Step 2: 커밋**

```bash
git add packages/core/tests/fixtures/basic/Cargo.toml
git commit -m "test: add Cargo.toml fixture for registry tests"
```

### Task 2: PackageRegistry 기반 클래스 변경

**Files:**
- Modify: `packages/core/src/registry/package-registry.ts:13-16` (생성자)
- Modify: `packages/core/src/registry/package-registry.ts:26` (dryRunPublish 시그니처)

- [ ] **Step 1: 생성자에 packagePath 추가**

```ts
// packages/core/src/registry/package-registry.ts:13-16
// Before:
constructor(
  public packageName: string,
  public registry?: string,
) {}

// After:
constructor(
  public packageName: string,
  public packagePath: string,
  public registry?: string,
) {}
```

- [ ] **Step 2: dryRunPublish에서 manifestDir 파라미터 제거**

```ts
// packages/core/src/registry/package-registry.ts:26
// Before:
async dryRunPublish(_manifestDir?: string): Promise<void> {}

// After:
async dryRunPublish(): Promise<void> {}
```

- [ ] **Step 3: typecheck 실행 — 의도적으로 실패 확인**

Run: `cd packages/core && bunx tsc --noEmit 2>&1 | head -30`
Expected: 서브클래스 생성자의 super() 호출과 테스트 생성자 호출에서 타입 에러 다수 발생

### Task 3: NpmPackageRegistry 변경

**Files:**
- Modify: `packages/core/src/registry/npm.ts:20-23` (runNpm 함수)
- Modify: `packages/core/src/registry/npm.ts:78-80` (생성자)
- Modify: `packages/core/src/registry/npm.ts:82-84` (npm 메서드)
- Modify: `packages/core/src/registry/npm.ts:192-209` (publish)
- Modify: `packages/core/src/registry/npm.ts:211-230` (publishProvenance)
- Modify: `packages/core/src/registry/npm.ts:232-251` (dryRunPublish)
- Modify: `packages/core/src/registry/npm.ts:422-427` (factory)

- [ ] **Step 1: runNpm에 cwd 파라미터 추가**

```ts
// packages/core/src/registry/npm.ts:20-23
// Before:
async function runNpm(args: string[]): Promise<string> {
  const { stdout } = await exec("npm", args, { throwOnError: true });
  return stdout;
}

// After:
async function runNpm(args: string[], cwd?: string): Promise<string> {
  const { stdout } = await exec("npm", args, {
    throwOnError: true,
    nodeOptions: cwd ? { cwd } : undefined,
  });
  return stdout;
}
```

- [ ] **Step 2: 생성자 변경 — packageName 필수, packagePath 추가**

```ts
// packages/core/src/registry/npm.ts:78-80
// Before:
constructor(packageName?: string, registry?: string) {
  super(packageName ?? "", registry ?? "https://registry.npmjs.org");
}

// After:
constructor(packageName: string, packagePath: string, registry?: string) {
  super(packageName, packagePath, registry ?? "https://registry.npmjs.org");
}
```

- [ ] **Step 3: npm() 메서드에 cwd 파라미터 추가**

```ts
// packages/core/src/registry/npm.ts:82-84
// Before:
protected async npm(args: string[]): Promise<string> {
  return runNpm(args);
}

// After:
protected async npm(args: string[], cwd?: string): Promise<string> {
  return runNpm(args, cwd);
}
```

- [ ] **Step 4: publish()에서 this.packagePath를 cwd로 전달**

```ts
// packages/core/src/registry/npm.ts:192-196
// Before:
async publish(otp?: string): Promise<boolean> {
  const args = otp ? ["publish", "--otp", otp] : ["publish"];
  try {
    await this.npm(args);

// After:
async publish(otp?: string): Promise<boolean> {
  const args = otp ? ["publish", "--otp", otp] : ["publish"];
  try {
    await this.npm(args, this.packagePath);
```

- [ ] **Step 5: publishProvenance()에서 this.packagePath를 cwd로 전달**

```ts
// packages/core/src/registry/npm.ts:212-213
// Before:
    await this.npm(["publish", "--provenance", "--access", "public"]);

// After:
    await this.npm(
      ["publish", "--provenance", "--access", "public"],
      this.packagePath,
    );
```

- [ ] **Step 6: dryRunPublish()에 cwd 추가 (기존 env와 병합)**

```ts
// packages/core/src/registry/npm.ts:234-242
// Before:
    await exec("npm", ["publish", "--dry-run"], {
      throwOnError: true,
      nodeOptions: {
        env: {
          ...process.env,
          npm_config_cache: join(tmpdir(), "pubm-npm-cache"),
        },
      },
    });

// After:
    await exec("npm", ["publish", "--dry-run"], {
      throwOnError: true,
      nodeOptions: {
        cwd: this.packagePath,
        env: {
          ...process.env,
          npm_config_cache: join(tmpdir(), "pubm-npm-cache"),
        },
      },
    });
```

- [ ] **Step 7: factory 함수에서 packagePath 전달**

```ts
// packages/core/src/registry/npm.ts:422-427
// Before:
export async function npmPackageRegistry(
  packagePath: string,
): Promise<NpmPackageRegistry> {
  const manifest = await NpmPackageRegistry.reader.read(packagePath);
  return new NpmPackageRegistry(manifest.name);
}

// After:
export async function npmPackageRegistry(
  packagePath: string,
): Promise<NpmPackageRegistry> {
  const manifest = await NpmPackageRegistry.reader.read(packagePath);
  return new NpmPackageRegistry(manifest.name, packagePath);
}
```

### Task 4: CustomPackageRegistry 변경

**Files:**
- Modify: `packages/core/src/registry/custom-registry.ts:5-12` (npm override)
- Modify: `packages/core/src/registry/custom-registry.ts:15-21` (factory)
- Modify: `packages/core/src/registry/catalog.ts:199-202` (private registry inline factory)

- [ ] **Step 1: npm() override에 cwd 파라미터 추가 및 exec에 전달**

```ts
// packages/core/src/registry/custom-registry.ts:4-13
// Before:
export class CustomPackageRegistry extends NpmPackageRegistry {
  override async npm(args: string[]): Promise<string> {
    const { stdout } = await exec(
      "npm",
      args.concat("--registry", this.registry!),
      { throwOnError: true },
    );
    return stdout;
  }
}

// After:
export class CustomPackageRegistry extends NpmPackageRegistry {
  override async npm(args: string[], cwd?: string): Promise<string> {
    const { stdout } = await exec(
      "npm",
      args.concat("--registry", this.registry!),
      {
        throwOnError: true,
        nodeOptions: cwd ? { cwd } : undefined,
      },
    );
    return stdout;
  }
}
```

- [ ] **Step 2: factory 함수에서 packagePath 전달**

```ts
// packages/core/src/registry/custom-registry.ts:15-21
// Before:
  return new CustomPackageRegistry(manifest.name, registryUrl);

// After:
  return new CustomPackageRegistry(manifest.name, packagePath, registryUrl);
```

- [ ] **Step 3: catalog.ts private registry inline factory 수정**

```ts
// packages/core/src/registry/catalog.ts:199-202
// Before:
    factory: async (packagePath) => {
      const manifest = await NpmPackageRegistry.reader.read(packagePath);
      return new CustomPackageRegistry(manifest.name, config.url);
    },

// After:
    factory: async (packagePath) => {
      const manifest = await NpmPackageRegistry.reader.read(packagePath);
      return new CustomPackageRegistry(manifest.name, packagePath, config.url);
    },
```

### Task 5: npm/custom 레지스트리 테스트 업데이트

**Files:**
- Modify: `packages/core/tests/unit/registry/npm.test.ts` (3곳: line 143, 660, 693)
- Modify: `packages/core/tests/unit/registry/custom-registry.test.ts` (3곳: line 25, 141, 149)
- Modify: `packages/core/tests/unit/registry/version-published.test.ts` (npm 3곳: line 9, 21, 30)

- [ ] **Step 1: npm.test.ts — 모든 생성자에 fixture 경로 추가**

각 파일 상단에 import 추가:
```ts
import path from "node:path";
```

`FIXTURE_PATH` 상수 추가 (describe 블록 밖 또는 해당 describe 내):
```ts
const FIXTURE_PATH = path.resolve(__dirname, "../../fixtures/basic");
```

3곳 변경:
```ts
// line 143: registry = new NpmPackageRegistry("my-package");
registry = new NpmPackageRegistry("my-package", FIXTURE_PATH);

// line 660: const registry = new NpmPackageRegistry("my-package");
const registry = new NpmPackageRegistry("my-package", FIXTURE_PATH);

// line 693: registry = new NpmPackageRegistry("my-package");
registry = new NpmPackageRegistry("my-package", FIXTURE_PATH);
```

- [ ] **Step 2: custom-registry.test.ts — 모든 생성자에 fixture 경로 추가**

상단에 import 및 상수 추가:
```ts
import path from "node:path";
const FIXTURE_PATH = path.resolve(__dirname, "../../fixtures/basic");
```

3곳 변경:
```ts
// line 25: registry = new CustomPackageRegistry("my-package");
registry = new CustomPackageRegistry("my-package", FIXTURE_PATH);

// line 141: const registry = new CustomPackageRegistry("test-pkg", "https://npm.internal.com");
const registry = new CustomPackageRegistry("test-pkg", FIXTURE_PATH, "https://npm.internal.com");

// line 149: const registry = new CustomPackageRegistry("test-pkg");
const registry = new CustomPackageRegistry("test-pkg", FIXTURE_PATH);
```

또한 `custom-registry.test.ts`의 `npm()` 호출 검증에서 `nodeOptions: { cwd }` 전달 확인이 필요할 수 있음. 기존 테스트가 `exec` 호출을 검증하므로 expected args 업데이트:

```ts
// line 43-47 (appends --registry flag test):
// Before:
expect(mockedExec).toHaveBeenCalledWith(
  "npm",
  ["publish", "--registry", "https://registry.npmjs.org"],
  { throwOnError: true },
);

// After:
expect(mockedExec).toHaveBeenCalledWith(
  "npm",
  ["publish", "--registry", "https://registry.npmjs.org"],
  {
    throwOnError: true,
    nodeOptions: { cwd: FIXTURE_PATH },
  },
);
```

- [ ] **Step 3: version-published.test.ts — npm 생성자 3곳에 fixture 경로 추가**

상단에 import 및 상수 추가:
```ts
import path from "node:path";
const FIXTURE_PATH = path.resolve(__dirname, "../../fixtures/basic");
```

```ts
// line 9:  const npm = new NpmPackageRegistry("test-package");
const npm = new NpmPackageRegistry("test-package", FIXTURE_PATH);

// line 21: const npm = new NpmPackageRegistry("test-package");
const npm = new NpmPackageRegistry("test-package", FIXTURE_PATH);

// line 30: const npm = new NpmPackageRegistry("test-package");
const npm = new NpmPackageRegistry("test-package", FIXTURE_PATH);
```

- [ ] **Step 4: 테스트 실행**

Run: `cd packages/core && bun vitest --run tests/unit/registry/npm.test.ts tests/unit/registry/custom-registry.test.ts tests/unit/registry/version-published.test.ts`
Expected: 일부 테스트 실패 가능 (jsr, crates 미수정). npm, custom 관련 테스트만 통과 확인.

- [ ] **Step 5: 커밋**

```bash
git add packages/core/src/registry/package-registry.ts packages/core/src/registry/npm.ts packages/core/src/registry/custom-registry.ts packages/core/src/registry/catalog.ts packages/core/tests/unit/registry/npm.test.ts packages/core/tests/unit/registry/custom-registry.test.ts packages/core/tests/unit/registry/version-published.test.ts
git commit -m "fix(core): add packagePath to PackageRegistry constructor and npm/custom registries"
```

---

## Chunk 2: jsr + crates 레지스트리

### Task 6: JsrPackageRegistry 변경

**Files:**
- Modify: `packages/core/src/registry/jsr.ts:100-104` (생성자)
- Modify: `packages/core/src/registry/jsr.ts:114-128` (publish)
- Modify: `packages/core/src/registry/jsr.ts:156-170` (dryRunPublish)
- Modify: `packages/core/src/registry/jsr.ts:595-600` (factory)

- [ ] **Step 1: 생성자에 packagePath 추가**

```ts
// packages/core/src/registry/jsr.ts:100-104
// Before:
constructor(packageName: string, registry?: string) {
  super(packageName, registry);
  this.client = new JsrClient(getApiEndpoint(this.registry));
}

// After:
constructor(packageName: string, packagePath: string, registry?: string) {
  super(packageName, packagePath, registry);
  this.client = new JsrClient(getApiEndpoint(this.registry));
}
```

- [ ] **Step 2: publish()에 cwd 추가**

```ts
// packages/core/src/registry/jsr.ts:125-127
// Before:
      {
        throwOnError: true,
      },

// After:
      {
        throwOnError: true,
        nodeOptions: { cwd: this.packagePath },
      },
```

- [ ] **Step 3: dryRunPublish()에 cwd 추가**

```ts
// packages/core/src/registry/jsr.ts:169
// Before:
      { throwOnError: true },

// After:
      {
        throwOnError: true,
        nodeOptions: { cwd: this.packagePath },
      },
```

- [ ] **Step 4: factory 함수에서 packagePath 전달**

```ts
// packages/core/src/registry/jsr.ts:595-600
// Before:
export async function jsrPackageRegistry(
  packagePath: string,
): Promise<JsrPackageRegistry> {
  const manifest = await JsrPackageRegistry.reader.read(packagePath);
  return new JsrPackageRegistry(manifest.name);
}

// After:
export async function jsrPackageRegistry(
  packagePath: string,
): Promise<JsrPackageRegistry> {
  const manifest = await JsrPackageRegistry.reader.read(packagePath);
  return new JsrPackageRegistry(manifest.name, packagePath);
}
```

### Task 7: CratesPackageRegistry 변경

**Files:**
- Modify: `packages/core/src/registry/crates.ts:101-103` (생성자)
- Modify: `packages/core/src/registry/crates.ts:144-160` (publish)
- Modify: `packages/core/src/registry/crates.ts:162-177` (dryRunPublish)
- Modify: `packages/core/src/registry/crates.ts:239-243` (factory)

- [ ] **Step 1: 생성자에 packagePath 추가**

```ts
// packages/core/src/registry/crates.ts:101-103
// Before:
constructor(packageName: string, registry = "https://crates.io") {
  super(packageName, registry);
}

// After:
constructor(packageName: string, packagePath: string, registry = "https://crates.io") {
  super(packageName, packagePath, registry);
}
```

- [ ] **Step 2: publish() — manifestDir 파라미터 제거, this.packagePath 사용**

```ts
// packages/core/src/registry/crates.ts:144-160
// Before:
async publish(manifestDir?: string): Promise<boolean> {
  try {
    const args = ["publish"];
    if (manifestDir) {
      args.push("--manifest-path", path.join(manifestDir, "Cargo.toml"));
    }
    await exec("cargo", args, { throwOnError: true });
    return true;

// After:
async publish(): Promise<boolean> {
  try {
    const args = ["publish"];
    if (this.packagePath) {
      args.push("--manifest-path", path.join(this.packagePath, "Cargo.toml"));
    }
    await exec("cargo", args, { throwOnError: true });
    return true;
```

- [ ] **Step 3: dryRunPublish() — manifestDir 파라미터 제거, this.packagePath 사용**

```ts
// packages/core/src/registry/crates.ts:162-177
// Before:
async dryRunPublish(manifestDir?: string): Promise<void> {
  try {
    const args = ["publish", "--dry-run"];
    if (manifestDir) {
      args.push("--manifest-path", path.join(manifestDir, "Cargo.toml"));
    }

// After:
async dryRunPublish(): Promise<void> {
  try {
    const args = ["publish", "--dry-run"];
    if (this.packagePath) {
      args.push("--manifest-path", path.join(this.packagePath, "Cargo.toml"));
    }
```

- [ ] **Step 4: factory — packagePath를 받아 manifest에서 name 읽기**

```ts
// packages/core/src/registry/crates.ts:239-243
// Before:
export async function cratesPackageRegistry(
  packageName: string,
): Promise<CratesPackageRegistry> {
  return new CratesPackageRegistry(packageName);
}

// After:
export async function cratesPackageRegistry(
  packagePath: string,
): Promise<CratesPackageRegistry> {
  const manifest = await CratesPackageRegistry.reader.read(packagePath);
  return new CratesPackageRegistry(manifest.name, packagePath);
}
```

### Task 8: jsr/crates 레지스트리 테스트 업데이트

**Files:**
- Modify: `packages/core/tests/unit/registry/jsr.test.ts` (4곳: line 182, 472, 1077, 1099)
- Modify: `packages/core/tests/unit/registry/crates.test.ts` (1곳: line 100)
- Modify: `packages/core/tests/unit/registry/version-published.test.ts` (crates 2곳: line 41, 54; jsr 2곳: line 65, 75)

- [ ] **Step 1: jsr.test.ts — 4곳에 fixture 경로 추가**

상단에 import 및 상수 추가 (없으면):
```ts
import path from "node:path";
const FIXTURE_PATH = path.resolve(__dirname, "../../fixtures/basic");
```

```ts
// line 182: registry = new JsrPackageRegistry("@scope/pkg");
registry = new JsrPackageRegistry("@scope/pkg", FIXTURE_PATH);

// line 472: const registry = new JsrPackageRegistry("@scope/my-package");
const registry = new JsrPackageRegistry("@scope/my-package", FIXTURE_PATH);

// line 1077: registry = new JsrPackageRegistry("@scope/pkg");
registry = new JsrPackageRegistry("@scope/pkg", FIXTURE_PATH);

// line 1099: const unscopedRegistry = new JsrPackageRegistry("my-pkg");
const unscopedRegistry = new JsrPackageRegistry("my-pkg", FIXTURE_PATH);
```

- [ ] **Step 2: crates.test.ts — 1곳에 fixture 경로 추가**

```ts
import path from "node:path";
const FIXTURE_PATH = path.resolve(__dirname, "../../fixtures/basic");

// line 100: registry = new CratesPackageRegistry("my-crate");
registry = new CratesPackageRegistry("my-crate", FIXTURE_PATH);
```

- [ ] **Step 3: version-published.test.ts — crates/jsr 생성자에 fixture 경로 추가**

```ts
// line 41: const crates = new CratesPackageRegistry("test-crate");
const crates = new CratesPackageRegistry("test-crate", FIXTURE_PATH);

// line 54: const crates = new CratesPackageRegistry("test-crate");
const crates = new CratesPackageRegistry("test-crate", FIXTURE_PATH);

// line 65: const jsr = new JsrPackageRegistry("@scope/name");
const jsr = new JsrPackageRegistry("@scope/name", FIXTURE_PATH);

// line 75: const jsr = new JsrPackageRegistry("@scope/name");
const jsr = new JsrPackageRegistry("@scope/name", FIXTURE_PATH);
```

- [ ] **Step 4: 레지스트리 테스트 전체 실행**

Run: `cd packages/core && bun vitest --run tests/unit/registry/`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add packages/core/src/registry/jsr.ts packages/core/src/registry/crates.ts packages/core/tests/unit/registry/
git commit -m "fix(core): add packagePath to jsr and crates registries"
```

---

## Chunk 3: Task 레이어 + runner

### Task 9: tasks/crates.ts 수정

**Files:**
- Modify: `packages/core/src/tasks/crates.ts`

- [ ] **Step 1: cratesPackageRegistry factory import 추가, packagePath 필수화, 직접 생성자 제거**

```ts
// packages/core/src/tasks/crates.ts
// Before (전체 파일):
import type { ListrTask } from "listr2";
import { getPackageVersion, type PubmContext } from "../context.js";
import { RustEcosystem } from "../ecosystem/rust.js";
import { AbstractError } from "../error.js";
import { CratesConnector, CratesPackageRegistry } from "../registry/crates.js";

class CratesError extends AbstractError {
  name = "crates.io Error";

  constructor(message: string, { cause }: { cause?: unknown } = {}) {
    super(message, { cause });
    this.stack = "";
  }
}

async function getCrateName(packagePath?: string): Promise<string> {
  const eco = new RustEcosystem(packagePath ?? process.cwd());
  return await eco.packageName();
}

export function createCratesAvailableCheckTask(
  packagePath?: string,
): ListrTask<PubmContext> {
  const label = packagePath ? ` (${packagePath})` : "";
  return {
    title: `Checking crates.io availability${label}`,
    task: async (): Promise<void> => {
      const packageName = await getCrateName(packagePath);
      const registry = new CratesPackageRegistry(packageName);
      const connector = new CratesConnector();

      if (!(await connector.isInstalled())) {
        throw new CratesError(
          "cargo is not installed. Please install Rust toolchain to proceed.",
        );
      }

      if (!(await registry.hasPermission())) {
        throw new CratesError(
          "No crates.io credentials found. Run `cargo login` or set CARGO_REGISTRY_TOKEN.",
        );
      }
    },
  };
}

export function createCratesPublishTask(
  packagePath?: string,
): ListrTask<PubmContext> {
  const label = packagePath ? ` (${packagePath})` : "";
  return {
    title: `Publishing to crates.io${label}`,
    task: async (ctx, task): Promise<void> => {
      const packageName = await getCrateName(packagePath);
      const registry = new CratesPackageRegistry(packageName);

      const version = getPackageVersion(ctx, packageName);

      // Pre-check: skip if version already published
      if (await registry.isVersionPublished(version)) {
        task.title = `[SKIPPED] crates.io${label}: v${version} already published`;
        task.output = `⚠ ${packageName}@${version} is already published on crates.io`;
        return task.skip();
      }

      try {
        task.output = `Publishing ${packageName}@${version} on crates.io...`;
        await registry.publish(packagePath);
      } catch (error) {
        // Fallback: catch "already uploaded" errors
        if (
          error instanceof Error &&
          error.message.includes("is already uploaded")
        ) {
          task.title = `[SKIPPED] crates.io${label}: v${version} already published`;
          task.output = `⚠ ${packageName}@${version} is already published on crates.io`;
          return task.skip();
        }
        throw error;
      }
    },
  };
}

// Backward-compatible static exports (used when no packages config)
export const cratesAvailableCheckTasks: ListrTask<PubmContext> =
  createCratesAvailableCheckTask();
export const cratesPublishTasks: ListrTask<PubmContext> =
  createCratesPublishTask();


// After (전체 파일):
import type { ListrTask } from "listr2";
import { getPackageVersion, type PubmContext } from "../context.js";
import { RustEcosystem } from "../ecosystem/rust.js";
import { AbstractError } from "../error.js";
import {
  CratesConnector,
  cratesPackageRegistry,
} from "../registry/crates.js";

class CratesError extends AbstractError {
  name = "crates.io Error";

  constructor(message: string, { cause }: { cause?: unknown } = {}) {
    super(message, { cause });
    this.stack = "";
  }
}

async function getCrateName(packagePath: string): Promise<string> {
  const eco = new RustEcosystem(packagePath);
  return await eco.packageName();
}

export function createCratesAvailableCheckTask(
  packagePath: string,
): ListrTask<PubmContext> {
  return {
    title: `Checking crates.io availability (${packagePath})`,
    task: async (): Promise<void> => {
      const registry = await cratesPackageRegistry(packagePath);
      const connector = new CratesConnector();

      if (!(await connector.isInstalled())) {
        throw new CratesError(
          "cargo is not installed. Please install Rust toolchain to proceed.",
        );
      }

      if (!(await registry.hasPermission())) {
        throw new CratesError(
          "No crates.io credentials found. Run `cargo login` or set CARGO_REGISTRY_TOKEN.",
        );
      }
    },
  };
}

export function createCratesPublishTask(
  packagePath: string,
): ListrTask<PubmContext> {
  return {
    title: `Publishing to crates.io (${packagePath})`,
    task: async (ctx, task): Promise<void> => {
      const packageName = await getCrateName(packagePath);
      const registry = await cratesPackageRegistry(packagePath);

      const version = getPackageVersion(ctx, packageName);

      // Pre-check: skip if version already published
      if (await registry.isVersionPublished(version)) {
        task.title = `[SKIPPED] crates.io (${packagePath}): v${version} already published`;
        task.output = `⚠ ${packageName}@${version} is already published on crates.io`;
        return task.skip();
      }

      try {
        task.output = `Publishing ${packageName}@${version} on crates.io...`;
        await registry.publish();
      } catch (error) {
        // Fallback: catch "already uploaded" errors
        if (
          error instanceof Error &&
          error.message.includes("is already uploaded")
        ) {
          task.title = `[SKIPPED] crates.io (${packagePath}): v${version} already published`;
          task.output = `⚠ ${packageName}@${version} is already published on crates.io`;
          return task.skip();
        }
        throw error;
      }
    },
  };
}
```

### Task 10: tasks/dry-run-publish.ts 수정

**Files:**
- Modify: `packages/core/src/tasks/dry-run-publish.ts`

- [ ] **Step 1: crates 관련 부분 수정 — factory 사용, siblingPaths, backward-compat 제거**

import 변경:
```ts
// Before:
import { CratesPackageRegistry } from "../registry/crates.js";
// After:
import { cratesPackageRegistry } from "../registry/crates.js";
```

`getCrateName` 함수 — packagePath 필수:
```ts
// Before:
async function getCrateName(packagePath?: string): Promise<string> {
  const eco = new RustEcosystem(packagePath ?? process.cwd());
  return await eco.packageName();
}

// After:
async function getCrateName(packagePath: string): Promise<string> {
  const eco = new RustEcosystem(packagePath);
  return await eco.packageName();
}
```

`findUnpublishedSiblingDeps` — siblingPaths 사용:
```ts
// Before:
async function findUnpublishedSiblingDeps(
  packagePath: string | undefined,
  siblingCrateNames: string[],
): Promise<string[]> {
  const eco = new RustEcosystem(packagePath ?? process.cwd());
  const deps = await eco.dependencies();
  const siblingDeps = deps.filter((d) => siblingCrateNames.includes(d));

  const results = await Promise.all(
    siblingDeps.map(async (name) => {
      const registry = new CratesPackageRegistry(name);
      const published = await registry.isPublished();
      return published ? null : name;
    }),
  );

  return results.filter((name): name is string => name !== null);
}

// After:
async function findUnpublishedSiblingDeps(
  packagePath: string,
  siblingPaths: string[],
): Promise<string[]> {
  const eco = new RustEcosystem(packagePath);
  const deps = await eco.dependencies();

  const siblingNameToPath = new Map<string, string>();
  await Promise.all(
    siblingPaths.map(async (p) => {
      const name = await getCrateName(p);
      siblingNameToPath.set(name, p);
    }),
  );

  const siblingDeps = deps.filter((d) => siblingNameToPath.has(d));

  const results = await Promise.all(
    siblingDeps.map(async (name) => {
      const registry = await cratesPackageRegistry(siblingNameToPath.get(name)!);
      const published = await registry.isPublished();
      return published ? null : name;
    }),
  );

  return results.filter((name): name is string => name !== null);
}
```

`createCratesDryRunPublishTask` — packagePath 필수, siblingPaths:
```ts
// Before:
export function createCratesDryRunPublishTask(
  packagePath?: string,
  siblingCrateNames?: string[],
): ListrTask<PubmContext> {
  const label = packagePath ? ` (${packagePath})` : "";
  ...
      const packageName = await getCrateName(packagePath);
      const registry = new CratesPackageRegistry(packageName);
      ...
      if (siblingCrateNames?.length) {
        const unpublished = await findUnpublishedSiblingDeps(
          packagePath,
          siblingCrateNames,
        );
      ...
      await withTokenRetry("crates", ctx, task, async () => {
        const packageName = await getCrateName(packagePath);
        const registry = new CratesPackageRegistry(packageName);
        await registry.dryRunPublish(packagePath);
      });
      ...
      if (match && siblingCrateNames?.includes(match[1])) {

// After:
export function createCratesDryRunPublishTask(
  packagePath: string,
  siblingPaths?: string[],
): ListrTask<PubmContext> {
  ...
      const registry = await cratesPackageRegistry(packagePath);
      const packageName = registry.packageName;
      ...
      if (siblingPaths?.length) {
        const unpublished = await findUnpublishedSiblingDeps(
          packagePath,
          siblingPaths,
        );
      ...
      await withTokenRetry("crates", ctx, task, async () => {
        const registry = await cratesPackageRegistry(packagePath);
        await registry.dryRunPublish();
      });
      ...
      // reactive fallback에서 siblingPaths의 name을 resolve해서 비교
      if (match && siblingPaths) {
        const siblingNames = await Promise.all(
          siblingPaths.map((p) => getCrateName(p)),
        );
        if (siblingNames.includes(match[1])) {
```

backward-compat export 제거:
```ts
// 삭제:
export const cratesDryRunPublishTask: ListrTask<PubmContext> =
  createCratesDryRunPublishTask();
```

### Task 11: tasks/runner.ts 수정

**Files:**
- Modify: `packages/core/src/tasks/runner.ts:159-163` (dry-run task map 시그니처)
- Modify: `packages/core/src/tasks/runner.ts:190-203` (siblingNames → siblingPaths)

- [ ] **Step 1: dry-run task map 시그니처 변경**

```ts
// packages/core/src/tasks/runner.ts:157-164
// Before:
const dryRunTaskMap: Record<
  string,
  (packagePath: string, siblingNames?: string[]) => ListrTask<PubmContext>
> = {
  npm: (p) => createNpmDryRunPublishTask(p),
  jsr: (p) => createJsrDryRunPublishTask(p),
  crates: (p, siblingNames) => createCratesDryRunPublishTask(p, siblingNames),
};

// After:
const dryRunTaskMap: Record<
  string,
  (packagePath: string, siblingPaths?: string[]) => ListrTask<PubmContext>
> = {
  npm: (p) => createNpmDryRunPublishTask(p),
  jsr: (p) => createJsrDryRunPublishTask(p),
  crates: (p, siblingPaths) => createCratesDryRunPublishTask(p, siblingPaths),
};
```

- [ ] **Step 2: collectDryRunPublishTasks에서 siblingNames → siblingPaths**

```ts
// packages/core/src/tasks/runner.ts:166-174
// Before:
function createDryRunTaskForPath(
  registryKey: string,
  packagePath: string,
  siblingNames?: string[],
): ListrTask<PubmContext> {
  const factory = dryRunTaskMap[registryKey];
  if (!factory)
    return { title: `Dry-run ${registryKey}`, task: async () => {} };
  return factory(packagePath, siblingNames);
}

// After:
function createDryRunTaskForPath(
  registryKey: string,
  packagePath: string,
  siblingPaths?: string[],
): ListrTask<PubmContext> {
  const factory = dryRunTaskMap[registryKey];
  if (!factory)
    return { title: `Dry-run ${registryKey}`, task: async () => {} };
  return factory(packagePath, siblingPaths);
}
```

```ts
// packages/core/src/tasks/runner.ts:190-215
// Before:
          let siblingNames: string[] | undefined;
          if (!descriptor?.concurrentPublish && packagePaths.length > 1) {
            const eco = await import("../ecosystem/index.js");
            const ecosystem = await eco.detectEcosystem(packagePaths[0]);
            if (ecosystem) {
              siblingNames = await Promise.all(
                packagePaths.map(async (p) => {
                  const e = await eco.detectEcosystem(p);
                  return e ? await e.packageName() : p;
                }),
              );
            }
          }

          ...
                paths.map((p) =>
                  createDryRunTaskForPath(registry, p, siblingNames),
                ),

// After:
          let siblingPaths: string[] | undefined;
          if (!descriptor?.concurrentPublish && packagePaths.length > 1) {
            siblingPaths = packagePaths;
          }

          ...
                paths.map((p) =>
                  createDryRunTaskForPath(registry, p, siblingPaths),
                ),
```

- [ ] **Step 3: typecheck 실행**

Run: `cd packages/core && bunx tsc --noEmit`
Expected: PASS (또는 테스트 파일 관련 에러만)

- [ ] **Step 4: 커밋**

```bash
git add packages/core/src/tasks/crates.ts packages/core/src/tasks/dry-run-publish.ts packages/core/src/tasks/runner.ts
git commit -m "fix(core): use factory and packagePath in crates/dry-run tasks, remove backward-compat exports"
```

---

## Chunk 4: Task 테스트 + 최종 검증

### Task 12: crates task 테스트 업데이트

**Files:**
- Modify: `packages/core/tests/unit/tasks/crates.test.ts`

- [ ] **Step 1: mock을 factory 기반으로 변경, backward-compat 테스트 제거**

주요 변경점:
- `CratesPackageRegistry` 직접 생성자 mock → `cratesPackageRegistry` factory mock
- `cratesAvailableCheckTasks`, `cratesPublishTasks` import 및 테스트 제거
- `createCratesAvailableCheckTask()` (인자 없음) 테스트 → `createCratesAvailableCheckTask(packagePath)` 테스트로 변경
- `createCratesPublishTask()` (인자 없음) 테스트 → 제거
- `mockPublish).toHaveBeenCalledWith(packagePath)` → `mockPublish).toHaveBeenCalledWith()` (인자 없음)
- `MockCratesRegistryCtor` 검증 제거 (factory 사용으로 내부 구현 상세)

### Task 13: dry-run-publish 테스트 업데이트

**Files:**
- Modify: `packages/core/tests/unit/tasks/dry-run-publish.test.ts`

- [ ] **Step 1: crates 관련 mock 변경**

주요 변경점:
- `CratesPackageRegistry` mock → `cratesPackageRegistry` factory mock
- `cratesDryRunPublishTask` import 및 테스트 (line 59, 121-125) 제거
- `siblingCrateNames` → `siblingPaths` 사용
- `mockDryRun).toHaveBeenCalledWith("packages/my-crate")` → `mockDryRun).toHaveBeenCalledWith()` (인자 없음)
- sibling 테스트: name 배열 대신 path 배열 전달

### Task 14: runner 테스트 업데이트

**Files:**
- Modify: `packages/core/tests/unit/tasks/runner.test.ts`
- Modify: `packages/core/tests/unit/tasks/runner-coverage.test.ts`

- [ ] **Step 1: backward-compat export mock 제거**

두 파일 모두:
```ts
// Before:
vi.mock("../../../src/tasks/crates.js", () => ({
  cratesPublishTasks: {
    title: "crates publish",
    task: vi.fn(),
  },

// After:
vi.mock("../../../src/tasks/crates.js", () => ({
  createCratesPublishTask: vi.fn().mockReturnValue({
    title: "crates publish",
    task: vi.fn(),
  }),
```

```ts
// Before:
  cratesDryRunPublishTask: {
    title: "Dry-run crates publish",
    task: vi.fn(),
  },

// After (제거 또는 create* 함수로 변경):
  createCratesDryRunPublishTask: vi.fn().mockReturnValue({
    title: "Dry-run crates publish",
    task: vi.fn(),
  }),
```

### Task 15: 최종 검증

- [ ] **Step 1: format**

Run: `bun run format`

- [ ] **Step 2: typecheck**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 3: 전체 테스트**

Run: `bun run test`
Expected: PASS

- [ ] **Step 4: 커밋**

```bash
git add packages/core/tests/unit/tasks/
git commit -m "test(core): update task tests for packagePath propagation"
```
