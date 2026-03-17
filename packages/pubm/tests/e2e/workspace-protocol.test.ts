import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  collectWorkspaceVersions,
  resolveWorkspaceProtocolsInManifests,
  restoreManifests,
} from "../../../core/src/monorepo/resolve-workspace.js";
import { type E2EContext, e2e } from "../utils/e2e.js";

describe("workspace protocol resolution", () => {
  let ctx: E2EContext;

  beforeAll(async () => {
    ctx = await e2e("monorepo-workspace-protocol");
  });

  afterAll(() => ctx.cleanup());

  it("should collect workspace versions from monorepo", () => {
    const versions = collectWorkspaceVersions(ctx.dir);

    expect(versions.size).toBe(3);
    expect(versions.get("@test/core")).toBe("1.0.0");
    expect(versions.get("@test/cli")).toBe("1.0.0");
    expect(versions.get("@test/utils")).toBe("1.0.0");
  });

  it("should resolve workspace:* to exact version", () => {
    const versions = collectWorkspaceVersions(ctx.dir);
    const cliPath = join(ctx.dir, "packages/cli");

    const backups = resolveWorkspaceProtocolsInManifests([cliPath], versions);

    const resolved = JSON.parse(
      readFileSync(join(cliPath, "package.json"), "utf-8"),
    );
    expect(resolved.dependencies["@test/core"]).toBe("1.0.0");

    restoreManifests(backups);
  });

  it("should resolve workspace:^ to caret range", () => {
    const versions = collectWorkspaceVersions(ctx.dir);
    const cliPath = join(ctx.dir, "packages/cli");

    const backups = resolveWorkspaceProtocolsInManifests([cliPath], versions);

    const resolved = JSON.parse(
      readFileSync(join(cliPath, "package.json"), "utf-8"),
    );
    expect(resolved.optionalDependencies["@test/utils"]).toBe("^1.0.0");

    restoreManifests(backups);
  });

  it("should resolve workspace:~ to tilde range", () => {
    const versions = collectWorkspaceVersions(ctx.dir);
    const utilsPath = join(ctx.dir, "packages/utils");

    const backups = resolveWorkspaceProtocolsInManifests(
      [utilsPath],
      versions,
    );

    const resolved = JSON.parse(
      readFileSync(join(utilsPath, "package.json"), "utf-8"),
    );
    expect(resolved.dependencies["@test/core"]).toBe("~1.0.0");

    restoreManifests(backups);
  });

  it("should strip workspace: prefix from static version in devDependencies", () => {
    const versions = collectWorkspaceVersions(ctx.dir);
    const utilsPath = join(ctx.dir, "packages/utils");

    const backups = resolveWorkspaceProtocolsInManifests(
      [utilsPath],
      versions,
    );

    const resolved = JSON.parse(
      readFileSync(join(utilsPath, "package.json"), "utf-8"),
    );
    expect(resolved.devDependencies["@test/core"]).toBe("^1.0.0");

    restoreManifests(backups);
  });

  it("should resolve all packages at once", () => {
    const versions = collectWorkspaceVersions(ctx.dir);
    const cliPath = join(ctx.dir, "packages/cli");
    const utilsPath = join(ctx.dir, "packages/utils");

    const backups = resolveWorkspaceProtocolsInManifests(
      [cliPath, utilsPath],
      versions,
    );

    expect(backups.size).toBe(2);

    const resolvedCli = JSON.parse(
      readFileSync(join(cliPath, "package.json"), "utf-8"),
    );
    const resolvedUtils = JSON.parse(
      readFileSync(join(utilsPath, "package.json"), "utf-8"),
    );

    // cli: workspace:* → 1.0.0, workspace:^ → ^1.0.0
    expect(resolvedCli.dependencies["@test/core"]).toBe("1.0.0");
    expect(resolvedCli.optionalDependencies["@test/utils"]).toBe("^1.0.0");

    // utils: workspace:~ → ~1.0.0, workspace:^1.0.0 → ^1.0.0
    expect(resolvedUtils.dependencies["@test/core"]).toBe("~1.0.0");
    expect(resolvedUtils.devDependencies["@test/core"]).toBe("^1.0.0");

    restoreManifests(backups);
  });

  it("should restore original workspace: protocols after resolve", () => {
    const versions = collectWorkspaceVersions(ctx.dir);
    const cliPath = join(ctx.dir, "packages/cli");
    const utilsPath = join(ctx.dir, "packages/utils");

    // Read originals
    const originalCli = readFileSync(
      join(cliPath, "package.json"),
      "utf-8",
    );
    const originalUtils = readFileSync(
      join(utilsPath, "package.json"),
      "utf-8",
    );

    // Resolve
    const backups = resolveWorkspaceProtocolsInManifests(
      [cliPath, utilsPath],
      versions,
    );

    // Verify files are modified
    const modifiedCli = readFileSync(
      join(cliPath, "package.json"),
      "utf-8",
    );
    expect(modifiedCli).not.toContain("workspace:");

    // Restore
    restoreManifests(backups);

    // Verify originals are back
    const restoredCli = readFileSync(
      join(cliPath, "package.json"),
      "utf-8",
    );
    const restoredUtils = readFileSync(
      join(utilsPath, "package.json"),
      "utf-8",
    );

    expect(restoredCli).toBe(originalCli);
    expect(restoredUtils).toBe(originalUtils);
  });

  it("should skip packages without workspace: dependencies", () => {
    const versions = collectWorkspaceVersions(ctx.dir);
    const corePath = join(ctx.dir, "packages/core");

    const backups = resolveWorkspaceProtocolsInManifests(
      [corePath],
      versions,
    );

    expect(backups.size).toBe(0);
  });
});
