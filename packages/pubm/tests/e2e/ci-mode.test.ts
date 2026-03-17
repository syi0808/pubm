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
      const { stderr } = await ctx.runWithEnv({
        ...process.env,
        CI: "true",
      } as Record<string, string>);
      expect(stderr).toContain("Version must be set in the CI environment");
    });

    it("should include error formatting in CI error output", async () => {
      const { stderr } = await ctx.runWithEnv({
        ...process.env,
        CI: "true",
      } as Record<string, string>);
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
      expect(stderr).toContain("Error");
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
