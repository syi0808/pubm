import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Mock exec to use Node.js child_process instead of Bun.spawn (unavailable in forks pool)
vi.mock("../../../core/src/utils/exec.js", () => ({
  exec: vi.fn(
    async (
      command: string,
      args: string[],
      options?: { nodeOptions?: { cwd?: string } },
    ) => {
      const cmd = [command, ...args].join(" ");
      try {
        const stdout = execSync(cmd, {
          cwd: options?.nodeOptions?.cwd,
          encoding: "utf-8",
          stdio: ["pipe", "pipe", "pipe"],
          timeout: 30_000,
        });
        return { stdout: stdout ?? "", stderr: "", exitCode: 0 };
      } catch (error: any) {
        throw new Error(
          `Command "${cmd}" failed: ${error.stderr ?? error.message}`,
        );
      }
    },
  ),
}));

import type { ResolvedPackageConfig } from "../../../core/src/config/types.js";
import { JsEcosystem } from "../../../core/src/ecosystem/js.js";
import { writeVersionsForEcosystem } from "../../../core/src/manifest/write-versions.js";
import { exec } from "../../../core/src/utils/exec.js";
import { type E2EContext, e2e } from "../utils/e2e.js";

const mockedExec = vi.mocked(exec);

describe("lockfile sync — bun workspace", () => {
  let ctx: E2EContext;
  let pkgAPath: string;
  let pkgBPath: string;

  beforeAll(async () => {
    ctx = await e2e("lockfile-sync-bun");
    pkgAPath = path.join(ctx.dir, "packages", "pkg-a");
    pkgBPath = path.join(ctx.dir, "packages", "pkg-b");

    // Generate a real bun.lock by running bun install
    execSync("bun install --lockfile-only", { cwd: ctx.dir, stdio: "pipe" });
  }, 30_000);

  afterAll(() => ctx.cleanup());

  it("should discover bun.lock from nested package and run bun install", async () => {
    const eco = new JsEcosystem(pkgAPath);
    const result = await eco.syncLockfile("optional");

    expect(result).toBe(path.join(ctx.dir, "bun.lock"));
    expect(mockedExec).toHaveBeenCalledWith(
      "bun",
      ["install", "--lockfile-only"],
      {
        nodeOptions: { cwd: ctx.dir },
      },
    );
  });

  it("should discover the same bun.lock from a different nested package", async () => {
    mockedExec.mockClear();
    const eco = new JsEcosystem(pkgBPath);
    const result = await eco.syncLockfile("optional");

    expect(result).toBe(path.join(ctx.dir, "bun.lock"));
    expect(mockedExec).toHaveBeenCalledWith(
      "bun",
      ["install", "--lockfile-only"],
      {
        nodeOptions: { cwd: ctx.dir },
      },
    );
  });

  it("should return undefined when mode is skip", async () => {
    mockedExec.mockClear();
    const eco = new JsEcosystem(pkgAPath);
    const result = await eco.syncLockfile("skip");

    expect(result).toBeUndefined();
    expect(mockedExec).not.toHaveBeenCalled();
  });

  it("should bump versions and sync lockfile via writeVersionsForEcosystem", async () => {
    const lockfilePath = path.join(ctx.dir, "bun.lock");

    const ecoA = new JsEcosystem(pkgAPath);
    const ecoB = new JsEcosystem(pkgBPath);

    const ecosystems: { eco: JsEcosystem; pkg: ResolvedPackageConfig }[] = [
      {
        eco: ecoA,
        pkg: {
          path: pkgAPath,
          name: "@test/pkg-a",
          version: "1.0.0",
          dependencies: [],
          registries: ["npm"],
        },
      },
      {
        eco: ecoB,
        pkg: {
          path: pkgBPath,
          name: "@test/pkg-b",
          version: "1.0.0",
          dependencies: ["@test/pkg-a"],
          registries: ["npm"],
        },
      },
    ];

    const versions = new Map<string, string>([
      [pkgAPath, "2.0.0"],
      [pkgBPath, "2.0.0"],
    ]);

    const modifiedFiles = await writeVersionsForEcosystem(
      ecosystems,
      versions,
      "optional",
    );

    // Verify versions were bumped in package.json
    const pkgAJson = JSON.parse(
      readFileSync(path.join(pkgAPath, "package.json"), "utf-8"),
    );
    const pkgBJson = JSON.parse(
      readFileSync(path.join(pkgBPath, "package.json"), "utf-8"),
    );
    expect(pkgAJson.version).toBe("2.0.0");
    expect(pkgBJson.version).toBe("2.0.0");

    // Verify lockfile path is in modified files (deduplicated — only once)
    const lockfileEntries = modifiedFiles.filter(
      (f) => path.basename(f) === "bun.lock",
    );
    expect(lockfileEntries).toHaveLength(1);
    expect(lockfileEntries[0]).toBe(lockfilePath);
  });
});

describe("lockfile sync — discovery with different package managers", () => {
  let ctx: E2EContext;
  let pkgPath: string;

  beforeAll(async () => {
    ctx = await e2e();
    pkgPath = path.join(ctx.dir, "packages", "my-pkg");

    mkdirSync(pkgPath, { recursive: true });
    writeFileSync(
      path.join(ctx.dir, "package.json"),
      JSON.stringify({
        name: "test-root",
        private: true,
        workspaces: ["packages/*"],
      }),
    );
    writeFileSync(
      path.join(pkgPath, "package.json"),
      JSON.stringify({ name: "@test/my-pkg", version: "1.0.0" }),
    );
  });

  afterAll(() => ctx.cleanup());

  it("should discover package-lock.json from nested package", async () => {
    const lockfilePath = path.join(ctx.dir, "package-lock.json");
    writeFileSync(lockfilePath, "{}");

    const eco = new JsEcosystem(pkgPath);
    // npm install --package-lock-only may fail, but discovery should work
    await eco.syncLockfile("optional");

    // Verify discovery happened (exec was called with npm)
    expect(mockedExec).toHaveBeenCalledWith(
      "npm",
      ["install", "--package-lock-only"],
      { nodeOptions: { cwd: ctx.dir } },
    );

    // Clean up for next test
    unlinkSync(lockfilePath);
  });

  it("should discover pnpm-lock.yaml from nested package", async () => {
    mockedExec.mockClear();
    const lockfilePath = path.join(ctx.dir, "pnpm-lock.yaml");
    writeFileSync(lockfilePath, "lockfileVersion: '9.0'\n");

    const eco = new JsEcosystem(pkgPath);
    await eco.syncLockfile("optional");

    expect(mockedExec).toHaveBeenCalledWith(
      "pnpm",
      ["install", "--lockfile-only"],
      { nodeOptions: { cwd: ctx.dir } },
    );

    unlinkSync(lockfilePath);
  });

  it("should discover yarn.lock and detect yarn v1 (no .yarnrc.yml)", async () => {
    mockedExec.mockClear();
    const lockfilePath = path.join(ctx.dir, "yarn.lock");
    writeFileSync(lockfilePath, "# yarn lockfile v1\n");

    const eco = new JsEcosystem(pkgPath);
    await eco.syncLockfile("optional");

    expect(mockedExec).toHaveBeenCalledWith("yarn", ["install"], {
      nodeOptions: { cwd: ctx.dir },
    });

    unlinkSync(lockfilePath);
  });

  it("should discover yarn.lock and detect yarn v2+ (.yarnrc.yml present)", async () => {
    mockedExec.mockClear();
    const lockfilePath = path.join(ctx.dir, "yarn.lock");
    writeFileSync(lockfilePath, "# yarn lockfile v1\n");
    writeFileSync(
      path.join(ctx.dir, ".yarnrc.yml"),
      "nodeLinker: node-modules\n",
    );

    const eco = new JsEcosystem(pkgPath);
    await eco.syncLockfile("optional");

    expect(mockedExec).toHaveBeenCalledWith(
      "yarn",
      ["install", "--mode", "update-lockfile"],
      { nodeOptions: { cwd: ctx.dir } },
    );

    unlinkSync(lockfilePath);
    unlinkSync(path.join(ctx.dir, ".yarnrc.yml"));
  });

  it("should return undefined when no lock file exists", async () => {
    mockedExec.mockClear();
    const eco = new JsEcosystem(pkgPath);
    const result = await eco.syncLockfile("optional");

    expect(result).toBeUndefined();
    expect(mockedExec).not.toHaveBeenCalled();
  });

  it("should throw on install failure in required mode", async () => {
    mockedExec.mockClear();
    // Create a lock file so discovery succeeds
    const lockfilePath = path.join(ctx.dir, "package-lock.json");
    writeFileSync(lockfilePath, "{}");

    // Override exec to simulate failure
    mockedExec.mockRejectedValueOnce(new Error("npm install failed"));

    const eco = new JsEcosystem(pkgPath);
    await expect(eco.syncLockfile("required")).rejects.toThrow(
      "npm install failed",
    );

    unlinkSync(lockfilePath);
  });

  it("should warn and return undefined on failure in optional mode", async () => {
    mockedExec.mockClear();
    const lockfilePath = path.join(ctx.dir, "package-lock.json");
    writeFileSync(lockfilePath, "{}");

    mockedExec.mockRejectedValueOnce(new Error("npm not found"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const eco = new JsEcosystem(pkgPath);
    const result = await eco.syncLockfile("optional");

    expect(result).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Failed to sync lockfile"),
    );

    warnSpy.mockRestore();
    unlinkSync(lockfilePath);
  });
});

describe("lockfile sync — deduplication in monorepo", () => {
  let ctx: E2EContext;
  let pkgAPath: string;
  let pkgBPath: string;

  beforeAll(async () => {
    ctx = await e2e("lockfile-sync-bun");
    pkgAPath = path.join(ctx.dir, "packages", "pkg-a");
    pkgBPath = path.join(ctx.dir, "packages", "pkg-b");

    // Generate a real bun.lock
    execSync("bun install --lockfile-only", { cwd: ctx.dir, stdio: "pipe" });
  }, 30_000);

  afterAll(() => ctx.cleanup());

  it("should sync lockfile only once for multiple packages sharing the same root", async () => {
    mockedExec.mockClear();

    const ecoA = new JsEcosystem(pkgAPath);
    const ecoB = new JsEcosystem(pkgBPath);

    const ecosystems: { eco: JsEcosystem; pkg: ResolvedPackageConfig }[] = [
      {
        eco: ecoA,
        pkg: {
          path: pkgAPath,
          name: "@test/pkg-a",
          version: "1.0.0",
          dependencies: [],
          registries: ["npm"],
        },
      },
      {
        eco: ecoB,
        pkg: {
          path: pkgBPath,
          name: "@test/pkg-b",
          version: "1.0.0",
          dependencies: ["@test/pkg-a"],
          registries: ["npm"],
        },
      },
    ];

    const versions = new Map<string, string>([
      [pkgAPath, "1.1.0"],
      [pkgBPath, "1.1.0"],
    ]);

    const modifiedFiles = await writeVersionsForEcosystem(
      ecosystems,
      versions,
      "optional",
    );

    // bun.lock should appear exactly once in modifiedFiles despite two ecosystems
    const lockfileEntries = modifiedFiles.filter((f) => f.endsWith("bun.lock"));
    expect(lockfileEntries).toHaveLength(1);
  });

  it("should return no lockfile paths when mode is skip", async () => {
    mockedExec.mockClear();

    const ecoA = new JsEcosystem(pkgAPath);

    const ecosystems: { eco: JsEcosystem; pkg: ResolvedPackageConfig }[] = [
      {
        eco: ecoA,
        pkg: {
          path: pkgAPath,
          name: "@test/pkg-a",
          version: "1.1.0",
          dependencies: [],
          registries: ["npm"],
        },
      },
    ];

    const versions = new Map<string, string>([[pkgAPath, "1.2.0"]]);

    const modifiedFiles = await writeVersionsForEcosystem(
      ecosystems,
      versions,
      "skip",
    );

    const lockfileEntries = modifiedFiles.filter((f) => f.endsWith("bun.lock"));
    expect(lockfileEntries).toHaveLength(0);
    expect(mockedExec).not.toHaveBeenCalled();
  });
});
