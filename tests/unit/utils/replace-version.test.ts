import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { replaceVersionAtPath } from "../../../src/utils/package.js";

describe("replaceVersionAtPath", () => {
  const tmpDir = path.join(import.meta.dirname, ".tmp-replace-version-test");

  beforeEach(() => {
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("replaces version in package.json at given path", async () => {
    writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ name: "test-pkg", version: "1.0.0" }, null, 2),
    );

    const files = await replaceVersionAtPath("2.0.0", tmpDir);

    expect(files).toContain(path.join(tmpDir, "package.json"));
    const updated = JSON.parse(
      readFileSync(path.join(tmpDir, "package.json"), "utf-8"),
    );
    expect(updated.version).toBe("2.0.0");
  });

  it("replaces version in jsr.json at given path", async () => {
    writeFileSync(
      path.join(tmpDir, "jsr.json"),
      JSON.stringify({ name: "@scope/test", version: "1.0.0" }, null, 2),
    );

    const files = await replaceVersionAtPath("2.0.0", tmpDir);

    expect(files).toContain(path.join(tmpDir, "jsr.json"));
    const updated = JSON.parse(
      readFileSync(path.join(tmpDir, "jsr.json"), "utf-8"),
    );
    expect(updated.version).toBe("2.0.0");
  });

  it("replaces version in both package.json and jsr.json", async () => {
    writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ name: "test-pkg", version: "1.0.0" }, null, 2),
    );
    writeFileSync(
      path.join(tmpDir, "jsr.json"),
      JSON.stringify({ name: "@scope/test", version: "1.0.0" }, null, 2),
    );

    const files = await replaceVersionAtPath("3.0.0", tmpDir);

    expect(files).toHaveLength(2);
    expect(files).toContain(path.join(tmpDir, "package.json"));
    expect(files).toContain(path.join(tmpDir, "jsr.json"));

    const updatedPkg = JSON.parse(
      readFileSync(path.join(tmpDir, "package.json"), "utf-8"),
    );
    expect(updatedPkg.version).toBe("3.0.0");

    const updatedJsr = JSON.parse(
      readFileSync(path.join(tmpDir, "jsr.json"), "utf-8"),
    );
    expect(updatedJsr.version).toBe("3.0.0");
  });

  it("returns empty array when no manifest files exist", async () => {
    const files = await replaceVersionAtPath("2.0.0", tmpDir);
    expect(files).toEqual([]);
  });
});
