import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  stat: vi.fn(),
}));

vi.mock("../../../src/utils/package-manager.js", () => ({
  getPackageManager: vi.fn(),
}));

import { readFile, stat, writeFile } from "node:fs/promises";
import { JsEcosystem } from "../../../src/ecosystem/js.js";
import { JsEcosystemDescriptor } from "../../../src/ecosystem/js-descriptor.js";
import { JsrPackageRegistry } from "../../../src/registry/jsr.js";
import { NpmPackageRegistry } from "../../../src/registry/npm.js";
import { getPackageManager } from "../../../src/utils/package-manager.js";

const mockedReadFile = vi.mocked(readFile);
const mockedWriteFile = vi.mocked(writeFile);
const mockedStat = vi.mocked(stat);
const mockedGetPackageManager = vi.mocked(getPackageManager);

beforeEach(() => {
  vi.clearAllMocks();
  NpmPackageRegistry.reader.clearCache();
  JsrPackageRegistry.reader.clearCache();
});

describe("JsEcosystem", () => {
  const pkgPath = "/fake/js-pkg";

  describe("detect", () => {
    it("returns true when package.json exists", async () => {
      mockedStat.mockResolvedValue({ isFile: () => true } as any);
      expect(await JsEcosystem.detect(pkgPath)).toBe(true);
    });

    it("returns false when package.json does not exist", async () => {
      mockedStat.mockRejectedValue(new Error("ENOENT"));
      expect(await JsEcosystem.detect(pkgPath)).toBe(false);
    });
  });

  describe("packageName", () => {
    it("reads name from package.json", async () => {
      mockedStat.mockResolvedValue({ isFile: () => true } as any);
      mockedReadFile.mockResolvedValue(
        JSON.stringify({ name: "my-lib", version: "1.0.0" }) as any,
      );

      const eco = new JsEcosystem(pkgPath);
      expect(await eco.packageName()).toBe("my-lib");
    });
  });

  describe("readVersion", () => {
    it("reads version from package.json", async () => {
      mockedStat.mockResolvedValue({ isFile: () => true } as any);
      mockedReadFile.mockResolvedValue(
        JSON.stringify({ name: "my-lib", version: "2.3.4" }) as any,
      );

      const eco = new JsEcosystem(pkgPath);
      expect(await eco.readVersion()).toBe("2.3.4");
    });
  });

  describe("writeVersion", () => {
    it("replaces version in package.json", async () => {
      const original = JSON.stringify(
        { name: "my-lib", version: "1.0.0" },
        null,
        2,
      );
      mockedReadFile.mockResolvedValue(original as any);

      const eco = new JsEcosystem(pkgPath);
      await eco.writeVersion("2.0.0");

      expect(mockedWriteFile).toHaveBeenCalled();
      const writtenContent = mockedWriteFile.mock.calls[0][1] as string;
      expect(writtenContent).toContain('"2.0.0"');
      expect(writtenContent).not.toContain('"1.0.0"');
    });

    it("silently skips files that do not exist (ENOENT)", async () => {
      const enoentError = new Error("File not found") as NodeJS.ErrnoException;
      enoentError.code = "ENOENT";
      mockedReadFile.mockRejectedValue(enoentError);

      const eco = new JsEcosystem(pkgPath);
      await eco.writeVersion("2.0.0");

      expect(mockedWriteFile).not.toHaveBeenCalled();
    });

    it("rethrows non-ENOENT errors during writeVersion", async () => {
      const eaccesError = new Error(
        "Permission denied",
      ) as NodeJS.ErrnoException;
      eaccesError.code = "EACCES";
      mockedReadFile.mockRejectedValue(eaccesError);

      const eco = new JsEcosystem(pkgPath);
      await expect(eco.writeVersion("2.0.0")).rejects.toThrow(
        "Permission denied",
      );
    });
  });

  describe("manifestFiles", () => {
    it("returns package.json", () => {
      const eco = new JsEcosystem(pkgPath);
      const files = eco.manifestFiles();
      expect(files).toContain("package.json");
    });
  });

  describe("defaultTestCommand", () => {
    it("returns <pm> run test", async () => {
      mockedGetPackageManager.mockResolvedValue("pnpm");
      const eco = new JsEcosystem(pkgPath);
      expect(await eco.defaultTestCommand()).toBe("pnpm run test");
    });
  });

  describe("defaultBuildCommand", () => {
    it("returns <pm> run build", async () => {
      mockedGetPackageManager.mockResolvedValue("npm");
      const eco = new JsEcosystem(pkgPath);
      expect(await eco.defaultBuildCommand()).toBe("npm run build");
    });
  });

  describe("supportedRegistries", () => {
    it("returns npm and jsr", () => {
      const eco = new JsEcosystem(pkgPath);
      expect(eco.supportedRegistries()).toEqual(["npm", "jsr"]);
    });
  });

  describe("createDescriptor", () => {
    it("returns JsEcosystemDescriptor with npmName when package.json exists", async () => {
      mockedStat.mockImplementation(async (filePath) => {
        const p = String(filePath);
        if (p.endsWith("package.json")) return { isFile: () => true } as any;
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      });
      mockedReadFile.mockImplementation(async (filePath) => {
        const p = String(filePath);
        if (p.endsWith("package.json")) {
          return JSON.stringify({
            name: "my-npm-pkg",
            version: "1.0.0",
          }) as any;
        }
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      });

      const eco = new JsEcosystem(pkgPath);
      const descriptor = await eco.createDescriptor();

      expect(descriptor).toBeInstanceOf(JsEcosystemDescriptor);
      const jsDescriptor = descriptor as JsEcosystemDescriptor;
      expect(jsDescriptor.npmName).toBe("my-npm-pkg");
      expect(jsDescriptor.jsrName).toBeUndefined();
      expect(jsDescriptor.path).toBe(pkgPath);
    });

    it("returns JsEcosystemDescriptor with both npmName and jsrName when both manifests exist", async () => {
      mockedStat.mockResolvedValue({ isFile: () => true } as any);
      mockedReadFile.mockImplementation(async (filePath) => {
        const p = String(filePath);
        if (p.endsWith("package.json")) {
          return JSON.stringify({
            name: "my-npm-pkg",
            version: "1.0.0",
          }) as any;
        }
        if (p.endsWith("jsr.json")) {
          return JSON.stringify({
            name: "@scope/my-jsr-pkg",
            version: "1.0.0",
          }) as any;
        }
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      });

      const eco = new JsEcosystem(pkgPath);
      const descriptor = await eco.createDescriptor();

      expect(descriptor).toBeInstanceOf(JsEcosystemDescriptor);
      const jsDescriptor = descriptor as JsEcosystemDescriptor;
      expect(jsDescriptor.npmName).toBe("my-npm-pkg");
      expect(jsDescriptor.jsrName).toBe("@scope/my-jsr-pkg");
    });

    it("returns JsEcosystemDescriptor with undefined names when no manifests exist", async () => {
      mockedStat.mockRejectedValue(
        Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
      );

      const eco = new JsEcosystem(pkgPath);
      const descriptor = await eco.createDescriptor();

      expect(descriptor).toBeInstanceOf(JsEcosystemDescriptor);
      const jsDescriptor = descriptor as JsEcosystemDescriptor;
      expect(jsDescriptor.npmName).toBeUndefined();
      expect(jsDescriptor.jsrName).toBeUndefined();
    });
  });
});
