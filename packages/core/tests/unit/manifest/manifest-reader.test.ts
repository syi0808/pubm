import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseJsonc } from "jsonc-parser/lib/esm/main.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
    parser: (_filename: string, raw: string) =>
      JSON.parse(raw) as Record<string, unknown>,
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

describe("multi-file support", () => {
  function makeMultiFileSchema(
    files: string[],
    overrides?: Partial<ManifestSchema>,
  ): ManifestSchema {
    return {
      file: files,
      parser: (filename: string, raw: string) => {
        if (filename.endsWith(".jsonc")) {
          return parseJsonc(raw) as Record<string, unknown>;
        }
        return JSON.parse(raw) as Record<string, unknown>;
      },
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

  describe("read()", () => {
    it("uses priority ordering and returns the first found file", async () => {
      const pkgDir = join(tmpDir, "multi-priority");
      mkdirSync(pkgDir, { recursive: true });
      writeFileSync(
        join(pkgDir, "jsr.json"),
        JSON.stringify({ name: "from-jsr", version: "1.0.0" }),
      );
      writeFileSync(
        join(pkgDir, "deno.json"),
        JSON.stringify({ name: "from-deno", version: "2.0.0" }),
      );

      const multiReader = new ManifestReader(
        makeMultiFileSchema(["jsr.json", "deno.json", "deno.jsonc"]),
      );
      const manifest = await multiReader.read(pkgDir);

      expect(manifest.name).toBe("from-jsr");
    });

    it("prefers primary file and falls back to secondary when primary is absent", async () => {
      const pkgDir = join(tmpDir, "multi-fallback");
      mkdirSync(pkgDir, { recursive: true });
      writeFileSync(
        join(pkgDir, "deno.json"),
        JSON.stringify({ name: "from-deno", version: "3.0.0" }),
      );

      const multiReader = new ManifestReader(
        makeMultiFileSchema(["jsr.json", "deno.json", "deno.jsonc"]),
      );
      const manifest = await multiReader.read(pkgDir);

      expect(manifest.name).toBe("from-deno");
      expect(manifest.version).toBe("3.0.0");
    });

    it("throws when no files in the list are found", async () => {
      const pkgDir = join(tmpDir, "multi-none");
      mkdirSync(pkgDir, { recursive: true });

      const multiReader = new ManifestReader(
        makeMultiFileSchema(["jsr.json", "deno.json", "deno.jsonc"]),
      );

      await expect(multiReader.read(pkgDir)).rejects.toThrow(
        /No manifest file found/,
      );
    });

    it("parses JSONC files (with comments) correctly", async () => {
      const pkgDir = join(tmpDir, "multi-jsonc");
      mkdirSync(pkgDir, { recursive: true });
      writeFileSync(
        join(pkgDir, "deno.jsonc"),
        `{
  // This is a comment
  "name": "jsonc-pkg",
  "version": "4.0.0"
}`,
      );

      const multiReader = new ManifestReader(
        makeMultiFileSchema(["jsr.json", "deno.json", "deno.jsonc"]),
      );
      const manifest = await multiReader.read(pkgDir);

      expect(manifest.name).toBe("jsonc-pkg");
      expect(manifest.version).toBe("4.0.0");
    });
  });

  describe("exists()", () => {
    it("returns true if any file in the list exists", async () => {
      const pkgDir = join(tmpDir, "multi-exists-any");
      mkdirSync(pkgDir, { recursive: true });
      writeFileSync(
        join(pkgDir, "deno.json"),
        JSON.stringify({ name: "x", version: "1.0.0" }),
      );

      const multiReader = new ManifestReader(
        makeMultiFileSchema(["jsr.json", "deno.json", "deno.jsonc"]),
      );

      expect(await multiReader.exists(pkgDir)).toBe(true);
    });

    it("returns false if none of the files exist", async () => {
      const pkgDir = join(tmpDir, "multi-exists-none");
      mkdirSync(pkgDir, { recursive: true });

      const multiReader = new ManifestReader(
        makeMultiFileSchema(["jsr.json", "deno.json", "deno.jsonc"]),
      );

      expect(await multiReader.exists(pkgDir)).toBe(false);
    });
  });

  describe("readAll()", () => {
    it("returns a map of all existing files", async () => {
      const pkgDir = join(tmpDir, "multi-readall");
      mkdirSync(pkgDir, { recursive: true });
      writeFileSync(
        join(pkgDir, "jsr.json"),
        JSON.stringify({ name: "jsr-pkg", version: "1.0.0" }),
      );
      writeFileSync(
        join(pkgDir, "deno.json"),
        JSON.stringify({ name: "deno-pkg", version: "2.0.0" }),
      );

      const multiReader = new ManifestReader(
        makeMultiFileSchema(["jsr.json", "deno.json", "deno.jsonc"]),
      );
      const all = await multiReader.readAll(pkgDir);

      expect(all.size).toBe(2);
      expect(all.get("jsr.json")?.name).toBe("jsr-pkg");
      expect(all.get("deno.json")?.name).toBe("deno-pkg");
      expect(all.has("deno.jsonc")).toBe(false);
    });

    it("returns an empty map when no files exist", async () => {
      const pkgDir = join(tmpDir, "multi-readall-empty");
      mkdirSync(pkgDir, { recursive: true });

      const multiReader = new ManifestReader(
        makeMultiFileSchema(["jsr.json", "deno.json", "deno.jsonc"]),
      );
      const all = await multiReader.readAll(pkgDir);

      expect(all.size).toBe(0);
    });

    it("does not use or populate the read() cache", async () => {
      const pkgDir = join(tmpDir, "multi-readall-nocache");
      mkdirSync(pkgDir, { recursive: true });
      writeFileSync(
        join(pkgDir, "jsr.json"),
        JSON.stringify({ name: "cached-pkg", version: "1.0.0" }),
      );

      const multiReader = new ManifestReader(
        makeMultiFileSchema(["jsr.json", "deno.json"]),
      );

      // readAll should not cache
      await multiReader.readAll(pkgDir);

      // Overwrite on disk
      writeFileSync(
        join(pkgDir, "jsr.json"),
        JSON.stringify({ name: "cached-pkg", version: "2.0.0" }),
      );

      // read() should get fresh data (not from a readAll cache)
      const manifest = await multiReader.read(pkgDir);
      expect(manifest.version).toBe("2.0.0");
    });
  });

  describe("validate()", () => {
    it("returns a clean result when no validate fn is provided", async () => {
      const pkgDir = join(tmpDir, "multi-validate-clean");
      mkdirSync(pkgDir, { recursive: true });
      writeFileSync(
        join(pkgDir, "jsr.json"),
        JSON.stringify({ name: "val-pkg", version: "1.0.0" }),
      );

      const multiReader = new ManifestReader(
        makeMultiFileSchema(["jsr.json", "deno.json"]),
      );
      const result = await multiReader.validate(pkgDir);

      expect(result.errors).toEqual([]);
      expect(result.warnings).toEqual([]);
      expect(result.resolved.name).toBe("val-pkg");
    });

    it("does NOT call schema.validate when provided but only one file exists", async () => {
      const pkgDir = join(tmpDir, "multi-validate-single");
      mkdirSync(pkgDir, { recursive: true });
      writeFileSync(
        join(pkgDir, "jsr.json"),
        JSON.stringify({ name: "single-pkg", version: "1.0.0" }),
      );

      const validateFn = vi.fn();

      const multiReader = new ManifestReader(
        makeMultiFileSchema(["jsr.json", "deno.json"], {
          validate: validateFn,
        }),
      );
      const result = await multiReader.validate(pkgDir);

      expect(validateFn).not.toHaveBeenCalled();
      expect(result.errors).toEqual([]);
      expect(result.warnings).toEqual([]);
      expect(result.resolved.name).toBe("single-pkg");
    });

    it("returns an error when no manifest files exist", async () => {
      const pkgDir = join(tmpDir, "multi-validate-empty");
      mkdirSync(pkgDir, { recursive: true });

      const multiReader = new ManifestReader(
        makeMultiFileSchema(["jsr.json", "deno.json"]),
      );
      const result = await multiReader.validate(pkgDir);

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatch(/No manifest file found/);
      expect(result.warnings).toEqual([]);
    });

    it("delegates to schema.validate when provided and multiple files exist", async () => {
      const pkgDir = join(tmpDir, "multi-validate-delegate");
      mkdirSync(pkgDir, { recursive: true });
      writeFileSync(
        join(pkgDir, "jsr.json"),
        JSON.stringify({ name: "pkg-a", version: "1.0.0" }),
      );
      writeFileSync(
        join(pkgDir, "deno.json"),
        JSON.stringify({ name: "pkg-a", version: "2.0.0" }),
      );

      const validateFn = vi.fn().mockReturnValue({
        resolved: {
          name: "pkg-a",
          version: "1.0.0",
          private: false,
          dependencies: [],
        },
        errors: ["version mismatch"],
        warnings: [],
      });

      const multiReader = new ManifestReader(
        makeMultiFileSchema(["jsr.json", "deno.json"], {
          validate: validateFn,
        }),
      );
      const result = await multiReader.validate(pkgDir);

      expect(validateFn).toHaveBeenCalledOnce();
      expect(result.errors).toEqual(["version mismatch"]);
    });
  });
});
