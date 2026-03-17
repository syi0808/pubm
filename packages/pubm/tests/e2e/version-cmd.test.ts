import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type E2EContext, e2e } from "../utils/e2e.js";

describe("pubm changesets version --help", () => {
  let ctx: E2EContext;

  beforeAll(async () => {
    ctx = await e2e("basic");
  });

  afterAll(() => ctx.cleanup());

  it("should show help for version command", async () => {
    const { stdout } = await ctx.run("changesets", "version", "--help");
    expect(stdout).toContain("version");
  });
});

describe("pubm changesets version --dry-run (no changesets)", () => {
  let ctx: E2EContext;

  beforeAll(async () => {
    ctx = await e2e("basic");
  });

  afterAll(() => ctx.cleanup());

  it("should report no changesets when none exist", async () => {
    const { stdout } = await ctx.run("changesets", "version", "--dry-run");
    expect(stdout).toContain("No changesets found");
  });
});

describe("pubm changesets version --dry-run (patch)", () => {
  let ctx: E2EContext;

  beforeAll(async () => {
    ctx = await e2e("with-changesets-patch");
  });

  afterAll(() => ctx.cleanup());

  it("should show dry-run output with version bump for a patch changeset", async () => {
    const { stdout } = await ctx.run("changesets", "version", "--dry-run");
    expect(stdout).toContain("dry-run");
    expect(stdout).toContain("my-pkg");
    expect(stdout).toContain("1.0.1");
    expect(stdout).toContain("patch");
  });
});

describe("pubm changesets version --dry-run (minor)", () => {
  let ctx: E2EContext;

  beforeAll(async () => {
    ctx = await e2e("with-changesets-minor");
  });

  afterAll(() => ctx.cleanup());

  it("should show dry-run output with version bump for a minor changeset", async () => {
    const { stdout } = await ctx.run("changesets", "version", "--dry-run");
    expect(stdout).toContain("dry-run");
    expect(stdout).toContain("my-pkg");
    expect(stdout).toContain("2.4.0");
    expect(stdout).toContain("minor");
  });
});

describe("pubm changesets version --dry-run (major)", () => {
  let ctx: E2EContext;

  beforeAll(async () => {
    ctx = await e2e("with-changesets-major");
  });

  afterAll(() => ctx.cleanup());

  it("should show dry-run output with version bump for a major changeset", async () => {
    const { stdout } = await ctx.run("changesets", "version", "--dry-run");
    expect(stdout).toContain("dry-run");
    expect(stdout).toContain("my-pkg");
    expect(stdout).toContain("2.0.0");
    expect(stdout).toContain("major");
  });
});

describe("pubm changesets version --dry-run (changelog preview)", () => {
  let ctx: E2EContext;

  beforeAll(async () => {
    ctx = await e2e();
    writeFileSync(
      path.join(ctx.dir, "package.json"),
      JSON.stringify({ name: "my-pkg", version: "1.0.0" }),
    );
    const changesetsDir = path.join(ctx.dir, ".pubm", "changesets");
    mkdirSync(changesetsDir, { recursive: true });
    writeFileSync(
      path.join(changesetsDir, "cool-feature.md"),
      '---\n"my-pkg": minor\n---\n\nAdded a cool feature\n',
    );
  });

  afterAll(() => ctx.cleanup());

  it("should include changelog preview in dry-run output", async () => {
    const { stdout } = await ctx.run("changesets", "version", "--dry-run");
    expect(stdout).toContain("dry-run");
    expect(stdout).toContain("Changelog");
    expect(stdout).toContain("Added a cool feature");
  });
});
