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
      "--phase",
      "publish",
      "--no-pre-check",
      "--no-condition-check",
    );

    expect(stderr).not.toContain("already published");
    expect(stderr).not.toContain("v already published");
  });
});
