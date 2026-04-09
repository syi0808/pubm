import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type E2EContext, e2e } from "../utils/e2e.js";

describe("pubm changesets add (fixed versioning)", () => {
  let ctx: E2EContext;

  beforeAll(async () => {
    ctx = await e2e("monorepo-fixed");
    await ctx.git.init().add(".").commit("init").done();
  });

  afterAll(() => ctx.cleanup());

  it("should create a changeset with all packages via CLI flags", async () => {
    const { exitCode, stderr } = await ctx.run(
      "changesets",
      "add",
      "--packages",
      "packages/a,packages/b",
      "--bump",
      "patch",
      "--message",
      "fix: all packages",
    );

    expect(stderr).toBe("");
    expect(exitCode).toBe(0);

    const changesetsDir = path.join(ctx.dir, ".pubm", "changesets");
    const files = readdirSync(changesetsDir).filter((f) => f.endsWith(".md"));
    expect(files.length).toBe(1);

    const content = readFileSync(path.join(changesetsDir, files[0]), "utf-8");
    expect(content).toContain("packages/a");
    expect(content).toContain("packages/b");
    expect(content).toContain("patch");
    expect(content).toContain("fix: all packages");
  });
});
