import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { E2EContext } from "../../utils/e2e.js";
import { e2e } from "../../utils/e2e.js";

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
