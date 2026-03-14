import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CratesPackageRegistry } from "../../../src/registry/crates.js";
import { JsrPackageRegistry } from "../../../src/registry/jsr.js";
import { NpmPackageRegistry } from "../../../src/registry/npm.js";

const tmpDir = join(
  process.env.TMPDIR ?? "/tmp",
  "manifest-reader-integration-test-" + process.pid,
);

beforeEach(() => {
  mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  NpmPackageRegistry.reader.clearCache();
  JsrPackageRegistry.reader.clearCache();
  CratesPackageRegistry.reader.clearCache();
});

describe("NpmPackageRegistry.reader", () => {
  it("reads name and version from package.json", async () => {
    const pkgDir = join(tmpDir, "npm-basic");
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
      join(pkgDir, "package.json"),
      JSON.stringify({ name: "@scope/my-pkg", version: "1.2.3" }),
    );

    const manifest = await NpmPackageRegistry.reader.read(pkgDir);

    expect(manifest.name).toBe("@scope/my-pkg");
    expect(manifest.version).toBe("1.2.3");
  });

  it("reads private flag when true", async () => {
    const pkgDir = join(tmpDir, "npm-private");
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
      join(pkgDir, "package.json"),
      JSON.stringify({ name: "private-pkg", version: "0.1.0", private: true }),
    );

    const manifest = await NpmPackageRegistry.reader.read(pkgDir);

    expect(manifest.private).toBe(true);
  });

  it("returns false for private when not set", async () => {
    const pkgDir = join(tmpDir, "npm-public");
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
      join(pkgDir, "package.json"),
      JSON.stringify({ name: "public-pkg", version: "0.1.0" }),
    );

    const manifest = await NpmPackageRegistry.reader.read(pkgDir);

    expect(manifest.private).toBe(false);
  });

  it("collects dependencies from dependencies, devDependencies, and peerDependencies", async () => {
    const pkgDir = join(tmpDir, "npm-deps");
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
      join(pkgDir, "package.json"),
      JSON.stringify({
        name: "deps-pkg",
        version: "1.0.0",
        dependencies: { lodash: "^4.0.0" },
        devDependencies: { vitest: "^1.0.0" },
        peerDependencies: { react: "^18.0.0" },
      }),
    );

    const manifest = await NpmPackageRegistry.reader.read(pkgDir);

    expect(manifest.dependencies).toContain("lodash");
    expect(manifest.dependencies).toContain("vitest");
    expect(manifest.dependencies).toContain("react");
    expect(manifest.dependencies).toHaveLength(3);
  });

  it("returns empty dependencies when none are set", async () => {
    const pkgDir = join(tmpDir, "npm-no-deps");
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
      join(pkgDir, "package.json"),
      JSON.stringify({ name: "no-deps-pkg", version: "1.0.0" }),
    );

    const manifest = await NpmPackageRegistry.reader.read(pkgDir);

    expect(manifest.dependencies).toEqual([]);
  });

  it("returns fallback values for missing name and version", async () => {
    const pkgDir = join(tmpDir, "npm-minimal");
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(join(pkgDir, "package.json"), JSON.stringify({}));

    const manifest = await NpmPackageRegistry.reader.read(pkgDir);

    expect(manifest.name).toBe("");
    expect(manifest.version).toBe("0.0.0");
  });

  it("registryType is npm", () => {
    expect(NpmPackageRegistry.registryType).toBe("npm");
  });
});

describe("JsrPackageRegistry.reader", () => {
  it("reads name and version from jsr.json", async () => {
    const pkgDir = join(tmpDir, "jsr-basic");
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
      join(pkgDir, "jsr.json"),
      JSON.stringify({ name: "@scope/jsr-pkg", version: "2.0.0" }),
    );

    const manifest = await JsrPackageRegistry.reader.read(pkgDir);

    expect(manifest.name).toBe("@scope/jsr-pkg");
    expect(manifest.version).toBe("2.0.0");
  });

  it("always returns false for private", async () => {
    const pkgDir = join(tmpDir, "jsr-private");
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
      join(pkgDir, "jsr.json"),
      JSON.stringify({ name: "@scope/jsr-pkg", version: "1.0.0" }),
    );

    const manifest = await JsrPackageRegistry.reader.read(pkgDir);

    expect(manifest.private).toBe(false);
  });

  it("always returns empty dependencies", async () => {
    const pkgDir = join(tmpDir, "jsr-deps");
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
      join(pkgDir, "jsr.json"),
      JSON.stringify({
        name: "@scope/jsr-pkg",
        version: "1.0.0",
        dependencies: { something: "1.0.0" },
      }),
    );

    const manifest = await JsrPackageRegistry.reader.read(pkgDir);

    expect(manifest.dependencies).toEqual([]);
  });

  it("returns fallback values for missing name and version", async () => {
    const pkgDir = join(tmpDir, "jsr-minimal");
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(join(pkgDir, "jsr.json"), JSON.stringify({}));

    const manifest = await JsrPackageRegistry.reader.read(pkgDir);

    expect(manifest.name).toBe("");
    expect(manifest.version).toBe("0.0.0");
  });

  it("registryType is jsr", () => {
    expect(JsrPackageRegistry.registryType).toBe("jsr");
  });
});

describe("CratesPackageRegistry.reader", () => {
  it("reads name and version from Cargo.toml", async () => {
    const pkgDir = join(tmpDir, "crates-basic");
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
      join(pkgDir, "Cargo.toml"),
      `[package]\nname = "my-crate"\nversion = "0.3.0"\n`,
    );

    const manifest = await CratesPackageRegistry.reader.read(pkgDir);

    expect(manifest.name).toBe("my-crate");
    expect(manifest.version).toBe("0.3.0");
  });

  it("returns false for private when publish is not set", async () => {
    const pkgDir = join(tmpDir, "crates-public");
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
      join(pkgDir, "Cargo.toml"),
      `[package]\nname = "my-crate"\nversion = "0.1.0"\n`,
    );

    const manifest = await CratesPackageRegistry.reader.read(pkgDir);

    expect(manifest.private).toBe(false);
  });

  it("returns true for private when publish = false", async () => {
    const pkgDir = join(tmpDir, "crates-private-false");
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
      join(pkgDir, "Cargo.toml"),
      `[package]\nname = "private-crate"\nversion = "0.1.0"\npublish = false\n`,
    );

    const manifest = await CratesPackageRegistry.reader.read(pkgDir);

    expect(manifest.private).toBe(true);
  });

  it("returns true for private when publish = []", async () => {
    const pkgDir = join(tmpDir, "crates-private-empty-arr");
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
      join(pkgDir, "Cargo.toml"),
      `[package]\nname = "private-crate"\nversion = "0.1.0"\npublish = []\n`,
    );

    const manifest = await CratesPackageRegistry.reader.read(pkgDir);

    expect(manifest.private).toBe(true);
  });

  it("collects dependencies from dependencies and build-dependencies", async () => {
    const pkgDir = join(tmpDir, "crates-deps");
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
      join(pkgDir, "Cargo.toml"),
      `[package]\nname = "deps-crate"\nversion = "0.1.0"\n\n[dependencies]\nserde = "1.0"\n\n[build-dependencies]\ncc = "1.0"\n`,
    );

    const manifest = await CratesPackageRegistry.reader.read(pkgDir);

    expect(manifest.dependencies).toContain("serde");
    expect(manifest.dependencies).toContain("cc");
    expect(manifest.dependencies).toHaveLength(2);
  });

  it("returns empty dependencies when none are set", async () => {
    const pkgDir = join(tmpDir, "crates-no-deps");
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
      join(pkgDir, "Cargo.toml"),
      `[package]\nname = "no-deps-crate"\nversion = "0.1.0"\n`,
    );

    const manifest = await CratesPackageRegistry.reader.read(pkgDir);

    expect(manifest.dependencies).toEqual([]);
  });

  it("returns fallback values when package section is missing", async () => {
    const pkgDir = join(tmpDir, "crates-minimal");
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(join(pkgDir, "Cargo.toml"), "");

    const manifest = await CratesPackageRegistry.reader.read(pkgDir);

    expect(manifest.name).toBe("");
    expect(manifest.version).toBe("0.0.0");
  });

  it("registryType is crates", () => {
    expect(CratesPackageRegistry.registryType).toBe("crates");
  });
});
