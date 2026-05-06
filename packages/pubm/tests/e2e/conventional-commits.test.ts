import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type E2EContext, e2e } from "../utils/e2e.js";

describe("conventional commits: patch bump from fix commit", () => {
  let ctx: E2EContext;

  beforeAll(async () => {
    ctx = await e2e();
    writeFileSync(
      path.join(ctx.dir, "package.json"),
      JSON.stringify({ name: "my-pkg", version: "1.0.0" }),
    );
    writeFileSync(path.join(ctx.dir, "pubm.config.js"), "export default {};\n");
    await ctx.git.init().add(".").commit("chore: initial commit").done();
    writeFileSync(path.join(ctx.dir, "src.ts"), "export const x = 1;\n");
    await ctx.git.add(".").commit("fix: correct off-by-one error").done();
  });

  afterAll(() => ctx.cleanup());

  it("should detect fix commit and recommend patch bump", async () => {
    const { stdout } = await ctx.run("changesets", "version", "--dry-run");
    expect(stdout).toContain("1.0.1");
    expect(stdout).toContain("patch");
  });
});

describe("conventional commits: minor bump from feat commit", () => {
  let ctx: E2EContext;

  beforeAll(async () => {
    ctx = await e2e();
    writeFileSync(
      path.join(ctx.dir, "package.json"),
      JSON.stringify({ name: "my-pkg", version: "1.0.0" }),
    );
    writeFileSync(path.join(ctx.dir, "pubm.config.js"), "export default {};\n");
    await ctx.git.init().add(".").commit("chore: initial commit").done();
    writeFileSync(path.join(ctx.dir, "src.ts"), "export const x = 1;\n");
    await ctx.git.add(".").commit("feat: add new feature").done();
  });

  afterAll(() => ctx.cleanup());

  it("should detect feat commit and recommend minor bump", async () => {
    const { stdout } = await ctx.run("changesets", "version", "--dry-run");
    expect(stdout).toContain("1.1.0");
    expect(stdout).toContain("minor");
  });
});

describe("conventional commits: major bump from breaking change", () => {
  let ctx: E2EContext;

  beforeAll(async () => {
    ctx = await e2e();
    writeFileSync(
      path.join(ctx.dir, "package.json"),
      JSON.stringify({ name: "my-pkg", version: "1.0.0" }),
    );
    writeFileSync(path.join(ctx.dir, "pubm.config.js"), "export default {};\n");
    await ctx.git.init().add(".").commit("chore: initial commit").done();
    writeFileSync(path.join(ctx.dir, "src.ts"), "export const x = 1;\n");
    await ctx.git.add(".").commit("feat!: remove deprecated API").done();
  });

  afterAll(() => ctx.cleanup());

  it("should detect breaking change and recommend major bump", async () => {
    const { stdout } = await ctx.run("changesets", "version", "--dry-run");
    expect(stdout).toContain("2.0.0");
    expect(stdout).toContain("major");
  });
});

describe("conventional commits: no bump when no conventional commits", () => {
  let ctx: E2EContext;

  beforeAll(async () => {
    ctx = await e2e();
    writeFileSync(
      path.join(ctx.dir, "package.json"),
      JSON.stringify({ name: "my-pkg", version: "1.0.0" }),
    );
    writeFileSync(path.join(ctx.dir, "pubm.config.js"), "export default {};\n");
    await ctx.git.init().add(".").commit("chore: initial commit").done();
    writeFileSync(path.join(ctx.dir, "src.ts"), "export const x = 1;\n");
    await ctx.git.add(".").commit("random non-conventional message").done();
  });

  afterAll(() => ctx.cleanup());

  it("should report no changesets when commits are not conventional", async () => {
    const { stdout } = await ctx.run("changesets", "version", "--dry-run");
    expect(stdout).toContain("No changesets found");
  });
});

describe("conventional commits: changeset takes priority over CC", () => {
  let ctx: E2EContext;

  beforeAll(async () => {
    ctx = await e2e();
    writeFileSync(
      path.join(ctx.dir, "package.json"),
      JSON.stringify({ name: "my-pkg", version: "1.0.0" }),
    );
    // Changesets and conventional commits are both analyzed. The merge strategy
    // picks the first source that has a recommendation for a given package, so
    // changesets always win when present.
    writeFileSync(path.join(ctx.dir, "pubm.config.js"), "export default {};\n");
    const changesetsDir = path.join(ctx.dir, ".pubm", "changesets");
    mkdirSync(changesetsDir, { recursive: true });
    writeFileSync(
      path.join(changesetsDir, "my-feature.md"),
      '---\n"my-pkg": patch\n---\n\nFix a small bug\n',
    );
    await ctx.git.init().add(".").commit("chore: initial commit").done();
    writeFileSync(path.join(ctx.dir, "src.ts"), "export const x = 1;\n");
    // This CC commit would suggest a minor bump, but the patch changeset should win
    await ctx.git.add(".").commit("feat: add something big").done();
  });

  afterAll(() => ctx.cleanup());

  it("should use changeset bump type (patch) rather than CC bump type (minor)", async () => {
    const { stdout } = await ctx.run("changesets", "version", "--dry-run");
    // Changeset source yields patch → 1.0.1; CC source would yield minor → 1.1.0.
    // Changeset source is registered first and its recommendation wins.
    expect(stdout).toContain("1.0.1");
    expect(stdout).toContain("patch");
    expect(stdout).not.toContain("1.1.0");
  });
});

describe("conventional commits: scope-based package mapping in a monorepo", () => {
  let ctx: E2EContext;

  beforeAll(async () => {
    ctx = await e2e();
    // Root workspace package.json (private, no version)
    writeFileSync(
      path.join(ctx.dir, "package.json"),
      JSON.stringify({ name: "monorepo-root", private: true }),
    );
    // Sub-packages
    const pkgCoreDir = path.join(ctx.dir, "packages", "core");
    const pkgUtilsDir = path.join(ctx.dir, "packages", "utils");
    mkdirSync(pkgCoreDir, { recursive: true });
    mkdirSync(pkgUtilsDir, { recursive: true });
    writeFileSync(
      path.join(pkgCoreDir, "package.json"),
      JSON.stringify({ name: "@test/core", version: "1.0.0" }),
    );
    writeFileSync(
      path.join(pkgUtilsDir, "package.json"),
      JSON.stringify({ name: "@test/utils", version: "2.0.0" }),
    );
    // Config that explicitly lists both packages
    writeFileSync(
      path.join(ctx.dir, "pubm.config.js"),
      [
        "export default {",
        "  packages: [",
        '    { path: "packages/core" },',
        '    { path: "packages/utils" },',
        "  ],",
        "};\n",
      ].join("\n"),
    );
    await ctx.git.init().add(".").commit("chore: initial commit").done();
    // A commit scoped to "core" should only affect the core package
    writeFileSync(path.join(pkgCoreDir, "index.ts"), "export {};\n");
    await ctx.git.add(".").commit("feat(core): new core API").done();
  });

  afterAll(() => ctx.cleanup());

  it("should apply the scoped commit only to the matching package (core)", async () => {
    const { stdout } = await ctx.run("changesets", "version", "--dry-run");
    // core: 1.0.0 → 1.1.0 (minor from feat)
    expect(stdout).toContain("@test/core");
    expect(stdout).toContain("1.1.0");
    // utils should not be bumped
    expect(stdout).not.toContain("@test/utils");
    expect(stdout).not.toContain("2.1.0");
  });
});

describe("conventional commits: commits are always analyzed with changesets", () => {
  let ctx: E2EContext;

  beforeAll(async () => {
    ctx = await e2e();
    writeFileSync(
      path.join(ctx.dir, "package.json"),
      JSON.stringify({ name: "my-pkg", version: "1.0.0" }),
    );
    writeFileSync(
      path.join(ctx.dir, "pubm.config.js"),
      "export default { release: { changesets: { directory: '.pubm/changesets' } } };\n",
    );
    await ctx.git.init().add(".").commit("chore: initial commit").done();
    writeFileSync(path.join(ctx.dir, "src.ts"), "export const x = 1;\n");
    await ctx.git.add(".").commit("feat: shiny new feature").done();
  });

  afterAll(() => ctx.cleanup());

  it("should produce a bump from conventional commits without changesets", async () => {
    const { stdout } = await ctx.run("changesets", "version", "--dry-run");
    expect(stdout).toContain("my-pkg");
    expect(stdout).toContain("1.1.0");
    expect(stdout).toContain("feat: shiny new feature");
  });
});
