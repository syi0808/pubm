# E2E Test Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace source-based E2E test execution with built binary execution, using layered test helpers (FixtureManager, GitFixture, BinaryRunner) behind an `e2e()` facade.

**Architecture:** Three independent layers (FixtureManager for fixture→temp copy, GitFixture for declarative git state, BinaryRunner for platform binary resolution) composed by an async `e2e()` facade. Existing `CliController` and `runPubmCli` are reused internally.

**Tech Stack:** TypeScript, Vitest, node:child_process, node:fs/promises

---

## File Structure

```
packages/pubm/tests/
  utils/
    fixture-manager.ts  — CREATE: FixtureManager class
    git-fixture.ts      — CREATE: GitFixture builder class
    binary-runner.ts    — CREATE: BinaryRunner class
    e2e.ts              — CREATE: e2e() facade + E2EContext interface
    cli.ts              — KEEP: existing CliController + runPubmCli (reused by BinaryRunner)
  e2e/
    help.test.ts        — MODIFY: migrate to e2e() facade
    error-handling.test.ts — MODIFY: migrate to e2e() facade
    ci-mode.test.ts     — MODIFY: migrate to e2e() facade
    config-loading.test.ts — MODIFY: migrate to e2e() facade
    cross-registry-name.test.ts — MODIFY: migrate to e2e() facade
    sync-discover.test.ts — MODIFY: migrate to e2e() facade
    version-cmd.test.ts — MODIFY: migrate to e2e() facade
  fixtures/             — MODIFY: add new fixtures needed for migrated tests
```

---

### Task 1: FixtureManager

**Files:**
- Create: `packages/pubm/tests/utils/fixture-manager.ts`
- Create: `packages/pubm/tests/unit/utils/fixture-manager.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// packages/pubm/tests/unit/utils/fixture-manager.test.ts
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FixtureManager } from "../../utils/fixture-manager.js";

describe("FixtureManager", () => {
  let manager: FixtureManager | undefined;

  afterEach(async () => {
    await manager?.cleanup();
  });

  it("should copy fixture directory to temp dir", async () => {
    manager = await FixtureManager.create("basic");

    expect(existsSync(manager.dir)).toBe(true);
    expect(manager.dir).toContain("pubm-e2e-basic-");

    const pkg = JSON.parse(
      await readFile(path.join(manager.dir, "package.json"), "utf-8"),
    );
    expect(pkg.name).toBe("test-package");
  });

  it("should create empty temp dir when no fixture name given", async () => {
    manager = await FixtureManager.create();

    expect(existsSync(manager.dir)).toBe(true);
    expect(manager.dir).toContain("pubm-e2e-empty-");
  });

  it("should throw when fixture does not exist", async () => {
    await expect(FixtureManager.create("nonexistent")).rejects.toThrow(
      "Fixture not found",
    );
  });

  it("should remove temp dir on cleanup", async () => {
    manager = await FixtureManager.create("basic");
    const dir = manager.dir;

    await manager.cleanup();
    expect(existsSync(dir)).toBe(false);
    manager = undefined; // prevent double cleanup in afterEach
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/pubm && bun vitest --run tests/unit/utils/fixture-manager.test.ts`
Expected: FAIL — cannot import FixtureManager

- [ ] **Step 3: Implement FixtureManager**

```ts
// packages/pubm/tests/utils/fixture-manager.ts
import { cp, mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const FIXTURES_DIR = path.resolve(import.meta.dirname, "../fixtures");

export class FixtureManager {
  private constructor(private tmpDir: string) {}

  static async create(fixtureName?: string): Promise<FixtureManager> {
    const prefix = fixtureName ?? "empty";
    const tmpDir = await mkdtemp(path.join(tmpdir(), `pubm-e2e-${prefix}-`));

    if (fixtureName) {
      const fixtureDir = path.join(FIXTURES_DIR, fixtureName);
      if (!existsSync(fixtureDir)) {
        await rm(tmpDir, { recursive: true, force: true });
        throw new Error(`Fixture not found: ${fixtureName} (looked in ${fixtureDir})`);
      }
      await cp(fixtureDir, tmpDir, { recursive: true });
    }

    return new FixtureManager(tmpDir);
  }

  get dir(): string {
    return this.tmpDir;
  }

  async cleanup(): Promise<void> {
    await rm(this.tmpDir, { recursive: true, force: true });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/pubm && bun vitest --run tests/unit/utils/fixture-manager.test.ts`
Expected: PASS — all 4 tests

- [ ] **Step 5: Commit**

```bash
git add packages/pubm/tests/utils/fixture-manager.ts packages/pubm/tests/unit/utils/fixture-manager.test.ts
git commit -m "feat(test): add FixtureManager for E2E fixture management"
```

---

### Task 2: GitFixture

**Files:**
- Create: `packages/pubm/tests/utils/git-fixture.ts`
- Create: `packages/pubm/tests/unit/utils/git-fixture.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// packages/pubm/tests/unit/utils/git-fixture.test.ts
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GitFixture } from "../../utils/git-fixture.js";

function exec(cmd: string, cwd: string): string {
  const { execSync } = require("node:child_process");
  return execSync(cmd, { cwd, encoding: "utf-8" }).trim();
}

describe("GitFixture", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "git-fixture-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("should init a git repo with default branch main", async () => {
    await new GitFixture(tmpDir).init().done();

    expect(existsSync(path.join(tmpDir, ".git"))).toBe(true);
    const branch = exec("git branch --show-current", tmpDir);
    expect(branch).toBe("main");
  });

  it("should set user.name and user.email automatically on init", async () => {
    await new GitFixture(tmpDir).init().done();

    const name = exec("git config user.name", tmpDir);
    const email = exec("git config user.email", tmpDir);
    expect(name).toBe("test");
    expect(email).toBe("test@test.com");
  });

  it("should init with custom branch name", async () => {
    await new GitFixture(tmpDir).init("develop").done();

    const branch = exec("git branch --show-current", tmpDir);
    expect(branch).toBe("develop");
  });

  it("should add, commit, and tag", async () => {
    const { writeFileSync } = require("node:fs");
    writeFileSync(path.join(tmpDir, "file.txt"), "hello");

    await new GitFixture(tmpDir)
      .init()
      .add(".")
      .commit("initial commit")
      .tag("v1.0.0")
      .done();

    const log = exec("git log --oneline", tmpDir);
    expect(log).toContain("initial commit");

    const tags = exec("git tag", tmpDir);
    expect(tags).toContain("v1.0.0");
  });

  it("should create and checkout branches", async () => {
    const { writeFileSync } = require("node:fs");
    writeFileSync(path.join(tmpDir, "file.txt"), "hello");

    await new GitFixture(tmpDir)
      .init()
      .add()
      .commit("initial")
      .branch("feature")
      .done();

    const branch = exec("git branch --show-current", tmpDir);
    expect(branch).toBe("feature");
  });

  it("should allow custom git config", async () => {
    await new GitFixture(tmpDir)
      .init()
      .config("user.name", "custom-user")
      .done();

    const name = exec("git config user.name", tmpDir);
    expect(name).toBe("custom-user");
  });

  it("should clear queue after done() for reuse", async () => {
    const { writeFileSync } = require("node:fs");
    writeFileSync(path.join(tmpDir, "a.txt"), "a");

    const git = new GitFixture(tmpDir);
    await git.init().add().commit("first").done();

    writeFileSync(path.join(tmpDir, "b.txt"), "b");
    await git.add().commit("second").done();

    const log = exec("git log --oneline", tmpDir);
    expect(log).toContain("first");
    expect(log).toContain("second");
  });

  it("should throw on command failure with stderr details", async () => {
    // commit without init should fail
    await expect(
      new GitFixture(tmpDir).commit("no repo").done(),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/pubm && bun vitest --run tests/unit/utils/git-fixture.test.ts`
Expected: FAIL — cannot import GitFixture

- [ ] **Step 3: Implement GitFixture**

```ts
// packages/pubm/tests/utils/git-fixture.ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

type GitCommand = () => Promise<void>;

export class GitFixture {
  private queue: GitCommand[] = [];

  constructor(private cwd: string) {}

  init(branch = "main"): this {
    this.queue.push(async () => {
      await this.exec("git", ["init", "-b", branch]);
      await this.exec("git", ["config", "user.name", "test"]);
      await this.exec("git", ["config", "user.email", "test@test.com"]);
    });
    return this;
  }

  config(key: string, value: string): this {
    this.queue.push(() => this.exec("git", ["config", key, value]));
    return this;
  }

  add(pathspec = "."): this {
    this.queue.push(() => this.exec("git", ["add", pathspec]));
    return this;
  }

  commit(message: string): this {
    this.queue.push(() => this.exec("git", ["commit", "-m", message]));
    return this;
  }

  tag(name: string): this {
    this.queue.push(() => this.exec("git", ["tag", name]));
    return this;
  }

  branch(name: string): this {
    this.queue.push(() => this.exec("git", ["checkout", "-b", name]));
    return this;
  }

  checkout(ref: string): this {
    this.queue.push(() => this.exec("git", ["checkout", ref]));
    return this;
  }

  async done(): Promise<void> {
    const commands = [...this.queue];
    this.queue = [];

    for (const cmd of commands) {
      await cmd;
    }
  }

  private async exec(command: string, args: string[]): Promise<void> {
    try {
      await execFileAsync(command, args, { cwd: this.cwd });
    } catch (error: any) {
      const stderr = error.stderr || error.message;
      throw new Error(
        `Git command failed: ${command} ${args.join(" ")}\n${stderr}`,
      );
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/pubm && bun vitest --run tests/unit/utils/git-fixture.test.ts`
Expected: PASS — all 8 tests

- [ ] **Step 5: Commit**

```bash
git add packages/pubm/tests/utils/git-fixture.ts packages/pubm/tests/unit/utils/git-fixture.test.ts
git commit -m "feat(test): add GitFixture builder for declarative git state"
```

---

### Task 3: BinaryRunner

**Files:**
- Create: `packages/pubm/tests/utils/binary-runner.ts`
- Create: `packages/pubm/tests/unit/utils/binary-runner.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// packages/pubm/tests/unit/utils/binary-runner.test.ts
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BinaryRunner } from "../../utils/binary-runner.js";

describe("BinaryRunner", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "binary-runner-test-"));
    // Create a minimal package.json so CLI doesn't error on missing manifest
    await writeFile(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ name: "test", version: "1.0.0" }),
    );
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("should resolve the binary path for current platform", () => {
    const runner = new BinaryRunner(tmpDir);
    const binaryPath = BinaryRunner.resolveBinaryPath();

    expect(binaryPath).toContain("platforms/");
    expect(binaryPath).toContain("/bin/pubm");
  });

  it("should run --help and capture stdout", async () => {
    const runner = new BinaryRunner(tmpDir);
    const { stdout, exitCode } = await runner.run("--help");

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Usage");
    expect(stdout).toContain("pubm");
  });

  it("should pass env variables via runWithEnv", async () => {
    const runner = new BinaryRunner(tmpDir);
    const { stderr } = await runner.runWithEnv(
      { ...process.env, CI: "true" } as Record<string, string>,
      "--publish-only",
    );

    // Should run in CI mode — will get some error but process should execute
    expect(stderr.length).toBeGreaterThan(0);
  });
});
```

Note: These tests require the binary to be built. If not built, tests will fail with "Binary not found" — this is expected. Run `bun run build` from repo root first.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/pubm && bun vitest --run tests/unit/utils/binary-runner.test.ts`
Expected: FAIL — cannot import BinaryRunner

- [ ] **Step 3: Implement BinaryRunner**

```ts
// packages/pubm/tests/utils/binary-runner.ts
import { existsSync } from "node:fs";
import path from "node:path";
import { runPubmCli } from "./cli.js";

const PLATFORM_MAP: Record<string, string> = {
  darwin: "darwin",
  linux: "linux",
  win32: "windows",
};

const ARCH_MAP: Record<string, string> = {
  arm64: "arm64",
  x64: "x64",
};

export type RunResult = Awaited<ReturnType<typeof runPubmCli>>;

export class BinaryRunner {
  constructor(private cwd: string) {}

  static resolveBinaryPath(): string {
    const platform = PLATFORM_MAP[process.platform];
    const arch = ARCH_MAP[process.arch];

    if (!platform || !arch) {
      throw new Error(
        `Unsupported platform: ${process.platform}-${process.arch}`,
      );
    }

    const binaryName = process.platform === "win32" ? "pubm.exe" : "pubm";
    const binaryPath = path.resolve(
      import.meta.dirname,
      "../../platforms",
      `${platform}-${arch}`,
      "bin",
      binaryName,
    );

    if (!existsSync(binaryPath)) {
      throw new Error(
        `Binary not found at ${binaryPath}. Run 'bun run build' first.`,
      );
    }

    return binaryPath;
  }

  async run(...args: string[]): Promise<RunResult> {
    const binaryPath = BinaryRunner.resolveBinaryPath();
    return runPubmCli(binaryPath, { nodeOptions: { cwd: this.cwd } }, ...args);
  }

  async runWithEnv(
    env: Record<string, string>,
    ...args: string[]
  ): Promise<RunResult> {
    const binaryPath = BinaryRunner.resolveBinaryPath();
    return runPubmCli(
      binaryPath,
      { nodeOptions: { cwd: this.cwd, env } },
      ...args,
    );
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/pubm && bun vitest --run tests/unit/utils/binary-runner.test.ts`
Expected: PASS — all 3 tests (requires binary to be built)

- [ ] **Step 5: Commit**

```bash
git add packages/pubm/tests/utils/binary-runner.ts packages/pubm/tests/unit/utils/binary-runner.test.ts
git commit -m "feat(test): add BinaryRunner for platform binary E2E execution"
```

---

### Task 4: e2e() Facade

**Files:**
- Create: `packages/pubm/tests/utils/e2e.ts`
- Create: `packages/pubm/tests/unit/utils/e2e.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// packages/pubm/tests/unit/utils/e2e.test.ts
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { e2e } from "../../utils/e2e.js";
import type { E2EContext } from "../../utils/e2e.js";

describe("e2e() facade", () => {
  let ctx: E2EContext | undefined;

  afterEach(async () => {
    await ctx?.cleanup();
  });

  it("should create context with fixture files", async () => {
    ctx = await e2e("basic");

    expect(existsSync(ctx.dir)).toBe(true);
    const pkg = JSON.parse(
      await readFile(path.join(ctx.dir, "package.json"), "utf-8"),
    );
    expect(pkg.name).toBe("test-package");
  });

  it("should create context without fixture (empty dir)", async () => {
    ctx = await e2e();

    expect(existsSync(ctx.dir)).toBe(true);
  });

  it("should provide git builder", async () => {
    ctx = await e2e("basic");

    // git should be a GitFixture instance with builder methods
    expect(ctx.git).toBeDefined();
    expect(typeof ctx.git.init).toBe("function");
    expect(typeof ctx.git.add).toBe("function");
    expect(typeof ctx.git.commit).toBe("function");
    expect(typeof ctx.git.done).toBe("function");
  });

  it("should provide run method", async () => {
    ctx = await e2e("basic");

    expect(typeof ctx.run).toBe("function");
    expect(typeof ctx.runWithEnv).toBe("function");
  });

  it("should clean up temp dir", async () => {
    ctx = await e2e("basic");
    const dir = ctx.dir;

    await ctx.cleanup();
    expect(existsSync(dir)).toBe(false);
    ctx = undefined;
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/pubm && bun vitest --run tests/unit/utils/e2e.test.ts`
Expected: FAIL — cannot import e2e

- [ ] **Step 3: Implement e2e() facade**

```ts
// packages/pubm/tests/utils/e2e.ts
import { BinaryRunner, type RunResult } from "./binary-runner.js";
import { FixtureManager } from "./fixture-manager.js";
import { GitFixture } from "./git-fixture.js";

export type { RunResult };

export interface E2EContext {
  readonly dir: string;
  readonly git: GitFixture;
  run(...args: string[]): Promise<RunResult>;
  runWithEnv(env: Record<string, string>, ...args: string[]): Promise<RunResult>;
  cleanup(): Promise<void>;
}

export async function e2e(fixtureName?: string): Promise<E2EContext> {
  const fixture = await FixtureManager.create(fixtureName);
  const runner = new BinaryRunner(fixture.dir);
  const git = new GitFixture(fixture.dir);

  return {
    get dir() {
      return fixture.dir;
    },
    get git() {
      return git;
    },
    run: (...args) => runner.run(...args),
    runWithEnv: (env, ...args) => runner.runWithEnv(env, ...args),
    cleanup: () => fixture.cleanup(),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/pubm && bun vitest --run tests/unit/utils/e2e.test.ts`
Expected: PASS — all 5 tests

- [ ] **Step 5: Commit**

```bash
git add packages/pubm/tests/utils/e2e.ts packages/pubm/tests/unit/utils/e2e.test.ts
git commit -m "feat(test): add e2e() facade composing FixtureManager, GitFixture, BinaryRunner"
```

---

### Task 5: Add Missing Fixtures for E2E Migration

**Files:**
- Create: `packages/pubm/tests/fixtures/ci-manifest/package.json`
- Create: `packages/pubm/tests/fixtures/ci-independent/package.json`
- Create: `packages/pubm/tests/fixtures/ci-independent/packages/a/package.json`
- Create: `packages/pubm/tests/fixtures/ci-independent/packages/b/package.json`
- Create: `packages/pubm/tests/fixtures/ci-independent/pubm.config.ts`
- Create: `packages/pubm/tests/fixtures/cross-registry/package.json`
- Create: `packages/pubm/tests/fixtures/cross-registry/packages/core/package.json`
- Create: `packages/pubm/tests/fixtures/cross-registry/packages/core/jsr.json`
- Create: `packages/pubm/tests/fixtures/cross-registry/pubm.config.ts`
- Create: `packages/pubm/tests/fixtures/sync-discover-json/package.json`
- Create: `packages/pubm/tests/fixtures/sync-discover-json/config.json`
- Create: `packages/pubm/tests/fixtures/sync-discover-text/package.json`
- Create: `packages/pubm/tests/fixtures/sync-discover-text/src/index.ts`
- Create: `packages/pubm/tests/fixtures/sync-discover-nested/package.json`
- Create: `packages/pubm/tests/fixtures/sync-discover-nested/sub/config.json`
- Create: `packages/pubm/tests/fixtures/sync-discover-nested-json/package.json`
- Create: `packages/pubm/tests/fixtures/sync-discover-nested-json/config.json`
- Create: `packages/pubm/tests/fixtures/with-changesets-patch/package.json`
- Create: `packages/pubm/tests/fixtures/with-changesets-patch/.pubm/changesets/abc123.md`
- Create: `packages/pubm/tests/fixtures/with-changesets-minor/package.json`
- Create: `packages/pubm/tests/fixtures/with-changesets-minor/.pubm/changesets/abc123.md`
- Create: `packages/pubm/tests/fixtures/with-changesets-major/package.json`
- Create: `packages/pubm/tests/fixtures/with-changesets-major/.pubm/changesets/abc123.md`

Analyze each existing E2E test to determine which inline fixture setups can be extracted. Create fixture directories for repeated patterns. Some tests create unique one-off setups — those can remain inline or use `e2e()` with no fixture name and manual file creation.

- [ ] **Step 1: Create ci-manifest fixture** (used by ci-mode.test.ts "should read version from manifest")

```
packages/pubm/tests/fixtures/ci-manifest/
  package.json: {"name": "test-pkg", "version": "1.0.0"}
```

- [ ] **Step 2: Create ci-independent fixture** (used by ci-mode.test.ts "should support independent versioning")

```
packages/pubm/tests/fixtures/ci-independent/
  package.json: {"name": "monorepo", "private": true, "workspaces": ["packages/*"]}
  packages/a/package.json: {"name": "@test/a", "version": "1.0.0"}
  packages/b/package.json: {"name": "@test/b", "version": "2.0.0"}
  pubm.config.ts: (independent versioning config with packages/a and packages/b)
```

- [ ] **Step 3: Create cross-registry fixture** (used by cross-registry-name.test.ts)

```
packages/pubm/tests/fixtures/cross-registry/
  package.json: {"name": "monorepo", "private": true, "workspaces": ["packages/*"]}
  packages/core/package.json: {"name": "@test/core", "version": "1.0.0"}
  packages/core/jsr.json: {"name": "@test/different-jsr-name", "version": "1.0.0", "exports": "./src/index.ts"}
  pubm.config.ts: (config with packages/core registries: npm, jsr)
```

- [ ] **Step 4: Create sync-discover fixtures** (used by sync-discover.test.ts)

Create multiple fixtures for each sync-discover test case:

```
packages/pubm/tests/fixtures/sync-discover-json/
  package.json: {"name": "my-pkg", "version": "1.0.0"}
  config.json: {"version": "1.0.0"}

packages/pubm/tests/fixtures/sync-discover-text/
  package.json: {"name": "my-pkg", "version": "1.0.0"}
  src/index.ts: (contains @version 1.0.0 JSDoc tag)

packages/pubm/tests/fixtures/sync-discover-nested/
  package.json: {"name": "my-pkg", "version": "1.0.0"}
  sub/config.json: {"version": "1.0.0"}

packages/pubm/tests/fixtures/sync-discover-nested-json/
  package.json: {"name": "my-pkg", "version": "1.0.0"}
  config.json: {"app": {"meta": {"version": "1.0.0"}}}
```

- [ ] **Step 5: Create changeset fixtures** (used by version-cmd.test.ts)

```
packages/pubm/tests/fixtures/with-changesets-patch/
  package.json: {"name": "my-pkg", "version": "1.0.0"}
  .pubm/changesets/abc123.md: (patch changeset)

packages/pubm/tests/fixtures/with-changesets-minor/
  package.json: {"name": "my-pkg", "version": "2.3.0"}
  .pubm/changesets/abc123.md: (minor changeset)

packages/pubm/tests/fixtures/with-changesets-major/
  package.json: {"name": "my-pkg", "version": "1.5.3"}
  .pubm/changesets/abc123.md: (major changeset)
```

- [ ] **Step 6: Commit**

```bash
git add packages/pubm/tests/fixtures/
git commit -m "feat(test): add E2E fixtures for ci-mode, cross-registry, sync-discover, version-cmd"
```

---

### Task 6: Migrate help.test.ts

**Files:**
- Modify: `packages/pubm/tests/e2e/help.test.ts`

- [ ] **Step 1: Rewrite test to use e2e() facade**

The help test doesn't need fixtures or git — it just runs `--help` and `--version`. Use `e2e()` with no fixture name.

```ts
// packages/pubm/tests/e2e/help.test.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type E2EContext, e2e } from "../utils/e2e.js";

describe("pubm --help", () => {
  let ctx: E2EContext;

  beforeAll(async () => {
    ctx = await e2e("basic");
  });

  afterAll(() => ctx.cleanup());

  it("should show help text with usage info", async () => {
    const { stdout } = await ctx.run("--help");
    expect(stdout).toContain("Usage");
    expect(stdout).toContain("pubm");
  });

  it("should list the --test-script option", async () => {
    const { stdout } = await ctx.run("--help");
    expect(stdout).toContain("--test-script");
  });

  it("should list the --build-script option", async () => {
    const { stdout } = await ctx.run("--help");
    expect(stdout).toContain("--build-script");
  });

  it("should list the -p, --preview option", async () => {
    const { stdout } = await ctx.run("--help");
    expect(stdout).toContain("-p, --preview");
  });

  it("should list the -b, --branch option", async () => {
    const { stdout } = await ctx.run("--help");
    expect(stdout).toContain("-b, --branch");
  });

  it("should list the --publish-only option", async () => {
    const { stdout } = await ctx.run("--help");
    expect(stdout).toContain("--publish-only");
  });

  it("should list the --registry option", async () => {
    const { stdout } = await ctx.run("--help");
    expect(stdout).toContain("--registry");
  });

  it("should list the -t, --tag option", async () => {
    const { stdout } = await ctx.run("--help");
    expect(stdout).toContain("-t, --tag");
  });

  it("should list the -c, --contents option", async () => {
    const { stdout } = await ctx.run("--help");
    expect(stdout).toContain("-c, --contents");
  });

  it("should show version format info with semver types", async () => {
    const { stdout } = await ctx.run("--help");
    expect(stdout).toContain("Version can be:");
    expect(stdout).toContain("major");
    expect(stdout).toContain("minor");
    expect(stdout).toContain("patch");
    expect(stdout).toContain("1.2.3");
  });

  it('should not show "(default: true)" in options', async () => {
    const { stdout } = await ctx.run("--help");
    expect(stdout).not.toContain("(default: true)");
  });
});

describe("pubm --version", () => {
  let ctx: E2EContext;

  beforeAll(async () => {
    ctx = await e2e("basic");
  });

  afterAll(() => ctx.cleanup());

  it("should show the current version number", async () => {
    const { stdout } = await ctx.run("--version");
    expect(stdout.trim()).toMatch(/\d+\.\d+\.\d+/);
  });
});
```

- [ ] **Step 2: Run migrated test**

Run: `cd packages/pubm && bun vitest --run tests/e2e/help.test.ts`
Expected: PASS — all tests (requires binary to be built)

- [ ] **Step 3: Commit**

```bash
git add packages/pubm/tests/e2e/help.test.ts
git commit -m "refactor(test): migrate help.test.ts to e2e() facade"
```

---

### Task 7: Migrate error-handling.test.ts

**Files:**
- Modify: `packages/pubm/tests/e2e/error-handling.test.ts`

- [ ] **Step 1: Rewrite test to use e2e() facade**

```ts
// packages/pubm/tests/e2e/error-handling.test.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type E2EContext, e2e } from "../utils/e2e.js";

describe("error handling", () => {
  let ctx: E2EContext;

  beforeAll(async () => {
    ctx = await e2e(); // empty dir — no package.json
  });

  afterAll(() => ctx.cleanup());

  it("should show error when running in directory without package.json", async () => {
    const { stderr } = await ctx.runWithEnv(
      { ...process.env, CI: "true" } as Record<string, string>,
      "1.0.0",
    );
    expect(stderr.length).toBeGreaterThan(0);
    expect(stderr).toContain("Error");
  });

  it("should contain package.json related error in stderr when run from empty directory", async () => {
    const { stderr } = await ctx.runWithEnv(
      { ...process.env, CI: "true" } as Record<string, string>,
      "--publish-only",
    );
    expect(stderr.length).toBeGreaterThan(0);
    expect(stderr).toContain("TypeError");
  });

  it("should exit without crashing when errors occur", async () => {
    const { exitCode } = await ctx.runWithEnv(
      { ...process.env, CI: "true" } as Record<string, string>,
      "--publish-only",
    );
    expect(exitCode).toBeDefined();
  });
});
```

- [ ] **Step 2: Run migrated test**

Run: `cd packages/pubm && bun vitest --run tests/e2e/error-handling.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/pubm/tests/e2e/error-handling.test.ts
git commit -m "refactor(test): migrate error-handling.test.ts to e2e() facade"
```

---

### Task 8: Migrate config-loading.test.ts

**Files:**
- Modify: `packages/pubm/tests/e2e/config-loading.test.ts`

- [ ] **Step 1: Rewrite test**

```ts
// packages/pubm/tests/e2e/config-loading.test.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type E2EContext, e2e } from "../utils/e2e.js";

describe("config loading", () => {
  let ctx: E2EContext;

  beforeAll(async () => {
    ctx = await e2e("basic");
  });

  afterAll(() => ctx.cleanup());

  it("pubm --help still works without config file", async () => {
    const { stdout, exitCode } = await ctx.run("--help");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Usage");
  });
});
```

- [ ] **Step 2: Run and commit**

Run: `cd packages/pubm && bun vitest --run tests/e2e/config-loading.test.ts`

```bash
git add packages/pubm/tests/e2e/config-loading.test.ts
git commit -m "refactor(test): migrate config-loading.test.ts to e2e() facade"
```

---

### Task 9: Migrate ci-mode.test.ts

**Files:**
- Modify: `packages/pubm/tests/e2e/ci-mode.test.ts`

This test has multiple scenarios with different fixtures. Each `describe` or independent scenario that needs different fixture state gets its own `e2e()` context.

- [ ] **Step 1: Rewrite test**

```ts
// packages/pubm/tests/e2e/ci-mode.test.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type E2EContext, e2e } from "../utils/e2e.js";

describe("CI mode", () => {
  describe("without version flag", () => {
    let ctx: E2EContext;

    beforeAll(async () => {
      ctx = await e2e("basic");
    });

    afterAll(() => ctx.cleanup());

    // Note: Original test ran from project root without cwd override.
    // Now runs against "basic" fixture — semantically equivalent since
    // the test only verifies the CI error message when no version flag is given.
    it("should show error when version is not provided and --publish-only is not set", async () => {
      const { stderr } = await ctx.runWithEnv(
        { ...process.env, CI: "true" } as Record<string, string>,
      );
      expect(stderr).toContain("Version must be set in the CI environment");
    });

    it("should include error formatting in CI error output", async () => {
      const { stderr } = await ctx.runWithEnv(
        { ...process.env, CI: "true" } as Record<string, string>,
      );
      expect(stderr).toContain("Error");
      expect(stderr.length).toBeGreaterThan(0);
    });
  });

  describe("publish-only in non-git dir", () => {
    let ctx: E2EContext;

    beforeAll(async () => {
      ctx = await e2e(); // empty dir, no git
    });

    afterAll(() => ctx.cleanup());

    it("should show error when --publish-only is used in a non-git directory", async () => {
      const { stderr } = await ctx.runWithEnv(
        { ...process.env, CI: "true" } as Record<string, string>,
        "--publish-only",
      );
      expect(stderr.length).toBeGreaterThan(0);
      expect(stderr).toContain("TypeError");
    });
  });

  describe("publish-only with manifest", () => {
    let ctx: E2EContext;

    beforeAll(async () => {
      ctx = await e2e("ci-manifest");
      await ctx.git.init().add(".").commit("init").done();
    });

    afterAll(() => ctx.cleanup());

    it("should read version from manifest in --publish-only mode", async () => {
      const { stderr } = await ctx.runWithEnv(
        { ...process.env, CI: "true" } as Record<string, string>,
        "--publish-only",
      );
      expect(stderr).not.toContain("Cannot find the latest tag");
      expect(stderr).not.toContain("Cannot parse the latest tag");
    });
  });

  describe("independent versioning", () => {
    let ctx: E2EContext;

    beforeAll(async () => {
      ctx = await e2e("ci-independent");
      await ctx.git.init().add(".").commit("init").done();
    });

    afterAll(() => ctx.cleanup());

    it("should support independent versioning in --ci mode", async () => {
      const { stderr } = await ctx.runWithEnv(
        { ...process.env, CI: "true" } as Record<string, string>,
        "--ci",
      );
      expect(stderr).not.toContain("Cannot find the latest tag");
      expect(stderr).not.toContain("Cannot parse the latest tag");
    });
  });
});
```

- [ ] **Step 2: Run migrated test**

Run: `cd packages/pubm && bun vitest --run tests/e2e/ci-mode.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/pubm/tests/e2e/ci-mode.test.ts
git commit -m "refactor(test): migrate ci-mode.test.ts to e2e() facade"
```

---

### Task 10: Migrate cross-registry-name.test.ts

**Files:**
- Modify: `packages/pubm/tests/e2e/cross-registry-name.test.ts`

- [ ] **Step 1: Rewrite test**

```ts
// packages/pubm/tests/e2e/cross-registry-name.test.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type E2EContext, e2e } from "../utils/e2e.js";

describe("cross-registry name mismatch", () => {
  let ctx: E2EContext;

  beforeAll(async () => {
    ctx = await e2e("cross-registry");
    await ctx.git.init().add(".").commit("init").done();
  });

  afterAll(() => ctx.cleanup());

  it("should create path-keyed versionPlan for package with different jsr.json name", async () => {
    const { stderr } = await ctx.runWithEnv(
      { ...process.env, CI: "true" } as Record<string, string>,
      "--publish-only",
      "--no-pre-check",
      "--no-condition-check",
    );

    expect(stderr).not.toContain("already published");
    expect(stderr).not.toContain("v already published");
  });
});
```

- [ ] **Step 2: Run and commit**

Run: `cd packages/pubm && bun vitest --run tests/e2e/cross-registry-name.test.ts`

```bash
git add packages/pubm/tests/e2e/cross-registry-name.test.ts
git commit -m "refactor(test): migrate cross-registry-name.test.ts to e2e() facade"
```

---

### Task 11: Migrate sync-discover.test.ts

**Files:**
- Modify: `packages/pubm/tests/e2e/sync-discover.test.ts`

This test has 10 test cases with different fixture setups. Read the full test file during implementation to understand each case's inline fixture, then map to the fixtures created in Task 5 or use `e2e()` with inline file creation where needed.

- [ ] **Step 1: Rewrite test using e2e() facade with appropriate fixtures**

Each test group that needs different files should use its own `e2e()` context with the matching fixture from Task 5. Tests that need unique setups (like node_modules skip) can use `e2e()` with no fixture and create files inline via `fs.writeFileSync`.

- [ ] **Step 2: Run migrated test**

Run: `cd packages/pubm && bun vitest --run tests/e2e/sync-discover.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/pubm/tests/e2e/sync-discover.test.ts
git commit -m "refactor(test): migrate sync-discover.test.ts to e2e() facade"
```

---

### Task 12: Migrate version-cmd.test.ts

**Files:**
- Modify: `packages/pubm/tests/e2e/version-cmd.test.ts`

- [ ] **Step 1: Rewrite test using e2e() facade with changeset fixtures**

Map each changeset scenario (patch, minor, major) to the corresponding fixture from Task 5. The help and "no changesets" tests can use the basic fixture.

- [ ] **Step 2: Run migrated test**

Run: `cd packages/pubm && bun vitest --run tests/e2e/version-cmd.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/pubm/tests/e2e/version-cmd.test.ts
git commit -m "refactor(test): migrate version-cmd.test.ts to e2e() facade"
```

---

### Task 13: Run Full Test Suite and Verify

**Files:** None (verification only)

- [ ] **Step 1: Build the binary**

Run: `cd /Users/classting/Workspace/temp/pubm && bun run build`

- [ ] **Step 2: Run all E2E tests**

Run: `cd packages/pubm && bun vitest --run tests/e2e/`
Expected: All tests PASS

- [ ] **Step 3: Run all unit tests for new helpers**

Run: `cd packages/pubm && bun vitest --run tests/unit/utils/`
Expected: All tests PASS

- [ ] **Step 4: Run full test suite**

Run: `bun run test`
Expected: All tests PASS

- [ ] **Step 5: Run format and typecheck**

Run: `bun run format && bun run typecheck`
Expected: No errors

- [ ] **Step 6: Final commit if any formatting fixes**

```bash
git add -A
git commit -m "chore: format"
```
