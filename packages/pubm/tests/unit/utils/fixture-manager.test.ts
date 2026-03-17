import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FixtureManager } from "../../utils/fixture-manager.js";

describe("FixtureManager", () => {
  let manager: FixtureManager | undefined;

  afterEach(async () => {
    await manager?.cleanup();
  });

  it("should copy fixture directory to temp dir", async () => {
    manager = await FixtureManager.create("basic");

    expect(existsSync(manager.dir)).toBe(true);
    expect(manager.dir).toContain("pubm-e2e-basic-");

    const pkg = JSON.parse(
      await readFile(path.join(manager.dir, "package.json"), "utf-8"),
    );
    expect(pkg.name).toBe("test-package");
  });

  it("should create empty temp dir when no fixture name given", async () => {
    manager = await FixtureManager.create();

    expect(existsSync(manager.dir)).toBe(true);
    expect(manager.dir).toContain("pubm-e2e-empty-");
  });

  it("should throw when fixture does not exist", async () => {
    await expect(FixtureManager.create("nonexistent")).rejects.toThrow(
      "Fixture not found",
    );
  });

  it("should remove temp dir on cleanup", async () => {
    manager = await FixtureManager.create("basic");
    const dir = manager.dir;

    await manager.cleanup();
    expect(existsSync(dir)).toBe(false);
    manager = undefined;
  });
});
