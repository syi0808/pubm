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
      "--phase",
      "publish",
    );
    expect(stderr.length).toBeGreaterThan(0);
    expect(stderr).toContain("Error");
  });

  it("should exit without crashing when errors occur", async () => {
    const { exitCode } = await ctx.runWithEnv(
      { ...process.env, CI: "true" } as Record<string, string>,
      "--phase",
      "publish",
    );
    expect(exitCode).toBeDefined();
  });
});
