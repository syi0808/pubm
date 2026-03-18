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

  it("should list the -d, --dry-run option", async () => {
    const { stdout } = await ctx.run("--help");
    expect(stdout).toContain("-d, --dry-run");
  });

  it("should list the --mode option", async () => {
    const { stdout } = await ctx.run("--help");
    expect(stdout).toContain("--mode");
  });

  it("should list the --phase option", async () => {
    const { stdout } = await ctx.run("--help");
    expect(stdout).toContain("--phase");
  });

  it("should list the -b, --branch option", async () => {
    const { stdout } = await ctx.run("--help");
    expect(stdout).toContain("-b, --branch");
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
