import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type E2EContext, e2e } from "../utils/e2e.js";

describe("pubm sync --discover", () => {
  describe("should show help when run without --discover flag", () => {
    let ctx: E2EContext;
    beforeAll(async () => {
      ctx = await e2e();
      writeFileSync(
        path.join(ctx.dir, "package.json"),
        JSON.stringify({ name: "test", version: "1.0.0" }),
      );
    });
    afterAll(() => ctx.cleanup());

    it("should show help when run without --discover flag", async () => {
      const { stdout } = await ctx.run("sync");
      expect(stdout).toContain("--discover");
    });
  });

  describe("should show sync help via pubm sync --help", () => {
    let ctx: E2EContext;
    beforeAll(async () => {
      ctx = await e2e();
    });
    afterAll(() => ctx.cleanup());

    it("should show sync help via pubm sync --help", async () => {
      const { stdout } = await ctx.run("sync", "--help");
      expect(stdout).toContain("sync");
    });
  });

  describe("should discover JSON version references", () => {
    let ctx: E2EContext;
    beforeAll(async () => {
      ctx = await e2e();
      writeFileSync(
        path.join(ctx.dir, "package.json"),
        JSON.stringify({ name: "test-pkg", version: "1.0.0" }),
      );
      writeFileSync(
        path.join(ctx.dir, "config.json"),
        JSON.stringify({ version: "1.0.0", name: "app" }),
      );
    });
    afterAll(() => ctx.cleanup());

    it("should discover JSON version references", async () => {
      const { stdout } = await ctx.run("sync", "--discover");
      expect(stdout).toContain("config.json");
      expect(stdout).toContain("JSON");
      expect(stdout).toContain("version");
    });
  });

  describe("should discover pattern-based version references in text files", () => {
    let ctx: E2EContext;
    beforeAll(async () => {
      ctx = await e2e();
      writeFileSync(
        path.join(ctx.dir, "package.json"),
        JSON.stringify({ name: "test-pkg", version: "2.5.0" }),
      );
      writeFileSync(
        path.join(ctx.dir, "lib.ts"),
        "/** @version 2.5.0 */\nexport const lib = {};\n",
      );
    });
    afterAll(() => ctx.cleanup());

    it("should discover pattern-based version references in text files", async () => {
      const { stdout } = await ctx.run("sync", "--discover");
      expect(stdout).toContain("lib.ts");
      expect(stdout).toContain("2.5.0");
    });
  });

  describe("should report no references when none exist", () => {
    let ctx: E2EContext;
    beforeAll(async () => {
      ctx = await e2e();
      writeFileSync(
        path.join(ctx.dir, "package.json"),
        JSON.stringify({ name: "test-pkg", version: "1.0.0" }),
      );
      writeFileSync(path.join(ctx.dir, "readme.txt"), "Hello world\n");
    });
    afterAll(() => ctx.cleanup());

    it("should report no references when none exist", async () => {
      const { stdout } = await ctx.run("sync", "--discover");
      expect(stdout).toContain("No version references found");
    });
  });

  describe("should show versionSync config suggestion when references are found", () => {
    let ctx: E2EContext;
    beforeAll(async () => {
      ctx = await e2e();
      writeFileSync(
        path.join(ctx.dir, "package.json"),
        JSON.stringify({ name: "test-pkg", version: "3.0.0" }),
      );
      writeFileSync(
        path.join(ctx.dir, "manifest.json"),
        JSON.stringify({ version: "3.0.0" }),
      );
    });
    afterAll(() => ctx.cleanup());

    it("should show versionSync config suggestion when references are found", async () => {
      const { stdout } = await ctx.run("sync", "--discover");
      expect(stdout).toContain("versionSync");
      expect(stdout).toContain("manifest.json");
    });
  });

  describe("should discover references in nested directories", () => {
    let ctx: E2EContext;
    beforeAll(async () => {
      ctx = await e2e();
      writeFileSync(
        path.join(ctx.dir, "package.json"),
        JSON.stringify({ name: "test-pkg", version: "1.2.3" }),
      );
      const subDir = path.join(ctx.dir, "src");
      mkdirSync(subDir, { recursive: true });
      writeFileSync(
        path.join(subDir, "meta.json"),
        JSON.stringify({ version: "1.2.3" }),
      );
    });
    afterAll(() => ctx.cleanup());

    it("should discover references in nested directories", async () => {
      const { stdout } = await ctx.run("sync", "--discover");
      expect(stdout).toContain("src/meta.json");
      expect(stdout).toContain("JSON");
    });
  });

  describe("should skip node_modules directory", () => {
    let ctx: E2EContext;
    beforeAll(async () => {
      ctx = await e2e();
      writeFileSync(
        path.join(ctx.dir, "package.json"),
        JSON.stringify({ name: "test-pkg", version: "1.0.0" }),
      );
      const nmDir = path.join(ctx.dir, "node_modules", "some-pkg");
      mkdirSync(nmDir, { recursive: true });
      writeFileSync(
        path.join(nmDir, "config.json"),
        JSON.stringify({ version: "1.0.0" }),
      );
    });
    afterAll(() => ctx.cleanup());

    it("should skip node_modules directory", async () => {
      const { stdout } = await ctx.run("sync", "--discover");
      expect(stdout).toContain("No version references found");
    });
  });

  describe("should show scanning message with current version", () => {
    let ctx: E2EContext;
    beforeAll(async () => {
      ctx = await e2e();
      writeFileSync(
        path.join(ctx.dir, "package.json"),
        JSON.stringify({ name: "test-pkg", version: "4.1.0" }),
      );
    });
    afterAll(() => ctx.cleanup());

    it("should show scanning message with current version", async () => {
      const { stdout } = await ctx.run("sync", "--discover");
      expect(stdout).toContain("Scanning");
      expect(stdout).toContain("4.1.0");
    });
  });

  describe("should discover nested JSON path references", () => {
    let ctx: E2EContext;
    beforeAll(async () => {
      ctx = await e2e();
      writeFileSync(
        path.join(ctx.dir, "package.json"),
        JSON.stringify({ name: "test-pkg", version: "1.0.0" }),
      );
      writeFileSync(
        path.join(ctx.dir, "settings.json"),
        JSON.stringify({ app: { meta: { version: "1.0.0" } } }),
      );
    });
    afterAll(() => ctx.cleanup());

    it("should discover nested JSON path references", async () => {
      const { stdout } = await ctx.run("sync", "--discover");
      expect(stdout).toContain("settings.json");
      expect(stdout).toContain("app.meta.version");
    });
  });
});
