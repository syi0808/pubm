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
