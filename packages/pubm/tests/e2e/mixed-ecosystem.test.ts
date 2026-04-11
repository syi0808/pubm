import { writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type E2EContext, e2e } from "../utils/e2e.js";

describe("mixed-ecosystem", () => {
  let ctx: E2EContext;

  beforeAll(async () => {
    ctx = await e2e("mixed-ecosystem");
    await ctx.git.init().add(".").commit("init").done();
  });

  afterAll(() => ctx.cleanup());

  it("discovers both JS and Rust packages from same directory", async () => {
    const { exitCode, stdout } = await ctx.run("inspect", "packages");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("my-cli");
    expect(stdout).toContain("my-cli-rs");
  });

  it("discovers only JS when ecosystem is explicit", async () => {
    const configContent = `export default { packages: [{ path: ".", ecosystem: "js" }] };\n`;
    writeFileSync(path.join(ctx.dir, "pubm.config.ts"), configContent);

    const { exitCode, stdout } = await ctx.run("inspect", "packages");
    expect(exitCode).toBe(0);
    expect(stdout).toContain("my-cli");
    expect(stdout).not.toContain("my-cli-rs");

    // Restore original config
    const originalConfig = `export default { packages: [{ path: "." }] };\n`;
    writeFileSync(path.join(ctx.dir, "pubm.config.ts"), originalConfig);
  });
});
