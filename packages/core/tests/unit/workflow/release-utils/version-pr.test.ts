import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PubmContext } from "../../../../src/context.js";
import {
  buildPrBodyFromContext,
  pushViaPr,
} from "../../../../src/workflow/release-utils/version-pr.js";

const versionPrState = vi.hoisted(() => ({
  closeCalls: [] as unknown[],
  createCalls: [] as unknown[],
  gitCalls: [] as Array<{ name: string; args: unknown[] }>,
}));

vi.mock("../../../../src/i18n/index.js", () => ({
  t: (key: string, values?: Record<string, unknown>) =>
    values ? `${key} ${JSON.stringify(values)}` : key,
}));

vi.mock("../../../../src/git.js", () => ({
  Git: class MockGit {
    async pushDelete(...args: string[]): Promise<void> {
      versionPrState.gitCalls.push({ name: "pushDelete", args });
    }
  },
}));

vi.mock("../../../../src/tasks/create-version-pr.js", () => ({
  closeVersionPr: vi.fn(async (input: unknown) => {
    versionPrState.closeCalls.push(input);
  }),
  createVersionPr: vi.fn(async (input: unknown) => {
    versionPrState.createCalls.push(input);
    return { number: 7, url: "https://github.test/pull/7" };
  }),
}));

let root = "";

function createContext(
  plan: PubmContext["runtime"]["versionPlan"],
): PubmContext & {
  rollbackItems: Array<{ label: string; fn: () => Promise<void> }>;
} {
  const rollbackItems: Array<{ label: string; fn: () => Promise<void> }> = [];
  return {
    rollbackItems,
    cwd: root,
    config: {
      branch: "main",
      packages: [
        {
          ecosystem: "js",
          name: "pkg-a",
          path: "packages/a",
          registries: ["npm"],
        },
        {
          ecosystem: "js",
          name: "pkg-b",
          path: "packages/b",
          registries: ["npm"],
        },
      ],
    },
    options: {},
    runtime: {
      cleanWorkingTree: true,
      pluginRunner: {} as PubmContext["runtime"]["pluginRunner"],
      promptEnabled: false,
      rollback: {
        add: (item: (typeof rollbackItems)[number]) => rollbackItems.push(item),
      } as unknown as PubmContext["runtime"]["rollback"],
      tag: "latest",
      versionPlan: plan,
    },
  } as PubmContext & { rollbackItems: typeof rollbackItems };
}

beforeEach(() => {
  root = path.join(tmpdir(), `pubm-version-pr-${Date.now()}`);
  mkdirSync(path.join(root, "packages/a"), { recursive: true });
  mkdirSync(path.join(root, "packages/b"), { recursive: true });
  versionPrState.closeCalls = [];
  versionPrState.createCalls = [];
  versionPrState.gitCalls = [];
  delete process.env.GITHUB_TOKEN;
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  delete process.env.GITHUB_TOKEN;
});

describe("buildPrBodyFromContext", () => {
  it("includes the root changelog section for single-package plans", () => {
    writeFileSync(
      path.join(root, "CHANGELOG.md"),
      "## 1.2.0\n\n- single change\n\n## 1.1.0\n",
    );
    const ctx = createContext({
      mode: "single",
      packageKey: "packages/a::js",
      version: "1.2.0",
    });

    expect(buildPrBodyFromContext(ctx, ctx.runtime.versionPlan!)).toContain(
      "single change",
    );
  });

  it("includes fixed package changelog sections when present", () => {
    writeFileSync(
      path.join(root, "packages/a/CHANGELOG.md"),
      "## 2.0.0\n\n- fixed change\n",
    );
    const ctx = createContext({
      mode: "fixed",
      packages: new Map([
        ["packages/a::js", "2.0.0"],
        ["packages/b::js", "2.0.0"],
      ]),
      version: "2.0.0",
    });

    const body = buildPrBodyFromContext(ctx, ctx.runtime.versionPlan!);

    expect(body).toContain("pkg-a");
    expect(body).toContain("fixed change");
    expect(body).toContain("pkg-b");
  });

  it("falls back to package paths for independent packages missing config", () => {
    const ctx = createContext({
      mode: "independent",
      packages: new Map([
        ["packages/a::js", "3.0.0"],
        ["packages/missing::js", "4.0.0"],
      ]),
    });
    writeFileSync(
      path.join(root, "packages/a/CHANGELOG.md"),
      "## 3.0.0\n\n- independent change\n",
    );

    const body = buildPrBodyFromContext(ctx, ctx.runtime.versionPlan!);

    expect(body).toContain("pkg-a");
    expect(body).toContain("independent change");
    expect(body).toContain("packages/missing");
  });
});

describe("pushViaPr", () => {
  it("throws after registering branch and tag rollback when token is missing", async () => {
    const ctx = createContext({
      mode: "fixed",
      packages: new Map([["packages/a::js", "1.2.0"]]),
      version: "1.2.0",
    });
    const git = {
      createBranch: vi.fn(async () => undefined),
      pushNewBranch: vi.fn(async () => undefined),
      repository: vi.fn(async () => "https://github.com/acme/repo.git"),
      switch: vi.fn(async () => undefined),
    };

    await expect(pushViaPr(ctx, git as never, { output: "" })).rejects.toThrow(
      "error.githubRelease.tokenRequired",
    );

    expect(ctx.rollbackItems.map((item) => item.label)).toEqual([
      expect.stringContaining("task.push.deleteRemoteBranch"),
      'task.push.deleteRemoteTag {"tag":"v1.2.0"}',
    ]);
  });

  it("creates a PR, registers close rollback, and switches back to the base branch", async () => {
    process.env.GITHUB_TOKEN = "gh-token";
    const ctx = createContext({
      mode: "fixed",
      packages: new Map([["packages/a::js", "1.2.0"]]),
      version: "1.2.0",
    });
    const git = {
      createBranch: vi.fn(async () => undefined),
      pushNewBranch: vi.fn(async () => undefined),
      repository: vi.fn(async () => "git@github.com:acme/repo.git"),
      switch: vi.fn(async () => undefined),
    };

    await pushViaPr(ctx, git as never, { output: "" });

    expect(versionPrState.createCalls[0]).toMatchObject({
      base: "main",
      branch: expect.stringContaining("pubm/version-packages-"),
      owner: "acme",
      repo: "repo",
      token: "gh-token",
    });
    expect(ctx.rollbackItems.at(-1)?.label).toBe(
      'task.push.closePr {"number":7}',
    );
    await ctx.rollbackItems.at(-1)?.fn();
    expect(versionPrState.closeCalls[0]).toMatchObject({ number: 7 });
    expect(git.switch).toHaveBeenCalledWith("main");
  });
});
