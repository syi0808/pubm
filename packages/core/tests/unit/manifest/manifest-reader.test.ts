import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ManifestReader,
  type ManifestSchema,
} from "../../../src/manifest/manifest-reader.js";

const tmpDir = join(
  process.env.TMPDIR ?? "/tmp",
  `manifest-reader-test-${process.pid}`,
);

function makeJsonSchema(overrides?: Partial<ManifestSchema>): ManifestSchema {
  return {
    file: "package.json",
    parser: (raw) => JSON.parse(raw) as Record<string, unknown>,
    fields: {
      name: (p) => (typeof p.name === "string" ? p.name : ""),
      version: (p) => (typeof p.version === "string" ? p.version : ""),
      private: (p) => p.private === true,
      dependencies: (p) =>
        p.dependencies != null && typeof p.dependencies === "object"
          ? Object.keys(p.dependencies as Record<string, string>)
          : [],
    },
    ...overrides,
  };
}

function writeManifest(dir: string, content: object): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify(content));
}

let reader: ManifestReader;

beforeEach(() => {
  mkdirSync(tmpDir, { recursive: true });
  reader = new ManifestReader(makeJsonSchema());
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("read", () => {
  it("reads and parses a manifest file correctly", async () => {
    const pkgDir = join(tmpDir, "pkg-a");
    writeManifest(pkgDir, {
      name: "@scope/pkg-a",
      version: "1.2.3",
      private: false,
      dependencies: { lodash: "^4.0.0", chalk: "^5.0.0" },
    });

    const manifest = await reader.read(pkgDir);

    expect(manifest.name).toBe("@scope/pkg-a");
    expect(manifest.version).toBe("1.2.3");
    expect(manifest.private).toBe(false);
    expect(manifest.dependencies).toEqual(["lodash", "chalk"]);
  });

  it("caches results and returns the same object reference", async () => {
    const pkgDir = join(tmpDir, "pkg-b");
    writeManifest(pkgDir, { name: "pkg-b", version: "0.1.0" });

    const first = await reader.read(pkgDir);
    const second = await reader.read(pkgDir);

    expect(first).toBe(second);
  });

  it("throws when the manifest file does not exist", async () => {
    const pkgDir = join(tmpDir, "nonexistent");
    mkdirSync(pkgDir, { recursive: true });

    await expect(reader.read(pkgDir)).rejects.toThrow();
  });

  it("uses fallback values for missing fields", async () => {
    const pkgDir = join(tmpDir, "pkg-minimal");
    writeManifest(pkgDir, {});

    const manifest = await reader.read(pkgDir);

    expect(manifest.name).toBe("");
    expect(manifest.version).toBe("");
    expect(manifest.private).toBe(false);
    expect(manifest.dependencies).toEqual([]);
  });
});

describe("exists", () => {
  it("returns true when the manifest file exists", async () => {
    const pkgDir = join(tmpDir, "pkg-exists");
    writeManifest(pkgDir, { name: "pkg-exists", version: "1.0.0" });

    expect(await reader.exists(pkgDir)).toBe(true);
  });

  it("returns false when the manifest file does not exist", async () => {
    const pkgDir = join(tmpDir, "pkg-missing");
    mkdirSync(pkgDir, { recursive: true });

    expect(await reader.exists(pkgDir)).toBe(false);
  });
});

describe("invalidate", () => {
  it("clears a specific cache entry so re-read returns updated data", async () => {
    const pkgDir = join(tmpDir, "pkg-inv");
    writeManifest(pkgDir, { name: "pkg-inv", version: "1.0.0" });

    const first = await reader.read(pkgDir);
    expect(first.version).toBe("1.0.0");

    // Overwrite on disk
    writeManifest(pkgDir, { name: "pkg-inv", version: "2.0.0" });

    // Without invalidation the cached value is returned
    const stillCached = await reader.read(pkgDir);
    expect(stillCached.version).toBe("1.0.0");

    reader.invalidate(pkgDir);

    const fresh = await reader.read(pkgDir);
    expect(fresh.version).toBe("2.0.0");
    expect(fresh).not.toBe(first);
  });
});

describe("clearCache", () => {
  it("clears all cache entries so re-reads return updated data", async () => {
    const pkgDir1 = join(tmpDir, "pkg-c1");
    const pkgDir2 = join(tmpDir, "pkg-c2");
    writeManifest(pkgDir1, { name: "pkg-c1", version: "1.0.0" });
    writeManifest(pkgDir2, { name: "pkg-c2", version: "1.0.0" });

    const first1 = await reader.read(pkgDir1);
    const first2 = await reader.read(pkgDir2);

    writeManifest(pkgDir1, { name: "pkg-c1", version: "2.0.0" });
    writeManifest(pkgDir2, { name: "pkg-c2", version: "2.0.0" });

    reader.clearCache();

    const fresh1 = await reader.read(pkgDir1);
    const fresh2 = await reader.read(pkgDir2);

    expect(fresh1.version).toBe("2.0.0");
    expect(fresh2.version).toBe("2.0.0");
    expect(fresh1).not.toBe(first1);
    expect(fresh2).not.toBe(first2);
  });
});
