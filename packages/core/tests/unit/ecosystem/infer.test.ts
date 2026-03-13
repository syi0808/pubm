import { readFile, stat } from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs/promises");

const mockedStat = vi.mocked(stat);
const mockedReadFile = vi.mocked(readFile);

describe("inferRegistries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function mockFileExists(...files: string[]) {
    mockedStat.mockImplementation(async (p) => {
      const path = typeof p === "string" ? p : p.toString();
      if (files.some((f) => path.endsWith(f))) {
        return { isFile: () => true } as any;
      }
      throw new Error("ENOENT");
    });
  }

  describe("JS ecosystem", () => {
    it("infers npm when only package.json exists", async () => {
      const { inferRegistries } = await import(
        "../../../src/ecosystem/infer.js"
      );
      mockFileExists("package.json");
      mockedReadFile.mockResolvedValue(JSON.stringify({ name: "test-pkg" }));
      const result = await inferRegistries("/project", "js");
      expect(result).toEqual(["npm"]);
    });

    it("infers npm + jsr when jsr.json exists", async () => {
      const { inferRegistries } = await import(
        "../../../src/ecosystem/infer.js"
      );
      mockFileExists("package.json", "jsr.json");
      mockedReadFile.mockResolvedValue(JSON.stringify({ name: "test-pkg" }));
      const result = await inferRegistries("/project", "js");
      expect(result).toContain("npm");
      expect(result).toContain("jsr");
    });

    it("infers jsr only when only jsr.json exists", async () => {
      const { inferRegistries } = await import(
        "../../../src/ecosystem/infer.js"
      );
      mockFileExists("jsr.json");
      const result = await inferRegistries("/project", "js");
      expect(result).toEqual(["jsr"]);
    });

    it("replaces npm with private registry from publishConfig.registry", async () => {
      const { inferRegistries } = await import(
        "../../../src/ecosystem/infer.js"
      );
      mockFileExists("package.json");
      mockedReadFile.mockImplementation(async (p) => {
        const path = typeof p === "string" ? p : p.toString();
        if (path.endsWith("package.json")) {
          return JSON.stringify({
            name: "test-pkg",
            publishConfig: { registry: "https://npm.internal.com" },
          });
        }
        throw new Error("ENOENT");
      });
      const result = await inferRegistries("/project", "js");
      expect(result).not.toContain("npm");
      expect(result).toContain("npm.internal.com");
    });

    it("replaces npm with private registry from project .npmrc", async () => {
      const { inferRegistries } = await import(
        "../../../src/ecosystem/infer.js"
      );
      mockFileExists("package.json", ".npmrc");
      mockedReadFile.mockImplementation(async (p) => {
        const path = typeof p === "string" ? p : p.toString();
        if (path.endsWith("package.json"))
          return JSON.stringify({ name: "test-pkg" });
        if (path.endsWith(".npmrc"))
          return "registry=https://npm.internal.com\n";
        throw new Error("ENOENT");
      });
      const result = await inferRegistries("/project", "js");
      expect(result).not.toContain("npm");
      expect(result).toContain("npm.internal.com");
    });

    it("publishConfig.registry takes precedence over .npmrc", async () => {
      const { inferRegistries } = await import(
        "../../../src/ecosystem/infer.js"
      );
      mockFileExists("package.json", ".npmrc");
      mockedReadFile.mockImplementation(async (p) => {
        const path = typeof p === "string" ? p : p.toString();
        if (path.endsWith("package.json")) {
          return JSON.stringify({
            name: "test-pkg",
            publishConfig: { registry: "https://npm.a.com" },
          });
        }
        if (path.endsWith(".npmrc")) return "registry=https://npm.b.com\n";
        throw new Error("ENOENT");
      });
      const result = await inferRegistries("/project", "js");
      expect(result).toContain("npm.a.com");
      expect(result).not.toContain("npm.b.com");
    });

    it("handles scoped registry from .npmrc", async () => {
      const { inferRegistries } = await import(
        "../../../src/ecosystem/infer.js"
      );
      mockFileExists("package.json", ".npmrc");
      mockedReadFile.mockImplementation(async (p) => {
        const path = typeof p === "string" ? p : p.toString();
        if (path.endsWith("package.json"))
          return JSON.stringify({ name: "@scope/test-pkg" });
        if (path.endsWith(".npmrc"))
          return "@scope:registry=https://npm.internal.com\n";
        throw new Error("ENOENT");
      });
      const result = await inferRegistries("/project", "js");
      expect(result).toContain("npm.internal.com");
    });
  });

  describe("Rust ecosystem", () => {
    it("returns crates as default", async () => {
      const { inferRegistries } = await import(
        "../../../src/ecosystem/infer.js"
      );
      const result = await inferRegistries("/project", "rust");
      expect(result).toEqual(["crates"]);
    });
  });

  describe("Unknown ecosystem", () => {
    it("returns empty array", async () => {
      const { inferRegistries } = await import(
        "../../../src/ecosystem/infer.js"
      );
      const result = await inferRegistries("/project", "unknown");
      expect(result).toEqual([]);
    });
  });
});
