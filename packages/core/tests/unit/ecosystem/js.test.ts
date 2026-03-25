import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  stat: vi.fn(),
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
  };
});

vi.mock("../../../src/utils/package-manager.js", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../../src/utils/package-manager.js")
    >();
  return {
    ...actual,
    getPackageManager: vi.fn(),
  };
});

vi.mock("../../../src/utils/exec.js", () => ({
  exec: vi.fn(),
}));

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import { JsEcosystem } from "../../../src/ecosystem/js.js";
import { JsEcosystemDescriptor } from "../../../src/ecosystem/js-descriptor.js";
import { JsrPackageRegistry } from "../../../src/registry/jsr.js";
import { NpmPackageRegistry } from "../../../src/registry/npm.js";
import { exec } from "../../../src/utils/exec.js";
import { getPackageManager } from "../../../src/utils/package-manager.js";

const mockedExec = vi.mocked(exec);
const mockedReadFile = vi.mocked(readFile);
const mockedWriteFile = vi.mocked(writeFile);
const mockedStat = vi.mocked(stat);
const mockedGetPackageManager = vi.mocked(getPackageManager);
const mockedExistsSync = vi.mocked(existsSync);
const mockedReadFileSync = vi.mocked(readFileSync);
const mockedWriteFileSync = vi.mocked(writeFileSync);

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

    it("returns true when deno.json exists (no package.json)", async () => {
      mockedStat.mockImplementation(async (p) => {
        const filePath = typeof p === "string" ? p : p.toString();
        if (filePath.endsWith("deno.json")) {
          return { isFile: () => true } as any;
        }
        throw new Error("ENOENT");
      });
      expect(await JsEcosystem.detect(pkgPath)).toBe(true);
    });

    it("returns true when deno.jsonc exists (no package.json)", async () => {
      mockedStat.mockImplementation(async (p) => {
        const filePath = typeof p === "string" ? p : p.toString();
        if (filePath.endsWith("deno.jsonc")) {
          return { isFile: () => true } as any;
        }
        throw new Error("ENOENT");
      });
      expect(await JsEcosystem.detect(pkgPath)).toBe(true);
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

    it("writes version to deno.json and deno.jsonc when they exist", async () => {
      const eco = new JsEcosystem(pkgPath);
      mockedReadFile.mockImplementation(async (p) => {
        const filePath = typeof p === "string" ? p : p.toString();
        if (filePath.endsWith("deno.json"))
          return '{ "name": "@scope/pkg", "version": "1.0.0" }' as any;
        if (filePath.endsWith("deno.jsonc"))
          return '// comment\n{ "name": "@scope/pkg", "version": "1.0.0" }' as any;
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      });

      await eco.writeVersion("2.0.0");

      // 4 files in the list: package.json (ENOENT), jsr.json (ENOENT), deno.json (written), deno.jsonc (written)
      expect(mockedWriteFile).toHaveBeenCalledTimes(2);
      const denoJsonCall = mockedWriteFile.mock.calls.find((c) =>
        (c[0] as string).endsWith("deno.json"),
      );
      expect(denoJsonCall?.[1]).toContain('"2.0.0"');
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

  describe("syncLockfile", () => {
    it("returns undefined when mode is skip", async () => {
      const eco = new JsEcosystem(pkgPath);
      const result = await eco.syncLockfile("skip");
      expect(result).toBeUndefined();
      expect(mockedExec).not.toHaveBeenCalled();
    });

    it("finds bun.lock walking upward and runs bun install", async () => {
      const lockPath = path.join("/workspace", "bun.lock");
      mockedStat.mockImplementation(async (filePath) => {
        if (String(filePath) === lockPath) return { isFile: () => true } as any;
        throw new Error("ENOENT");
      });
      mockedExec.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });

      const eco = new JsEcosystem(
        path.join("/workspace", "packages", "my-pkg"),
      );
      const result = await eco.syncLockfile();

      expect(result).toBe(lockPath);
      expect(mockedExec).toHaveBeenCalledWith(
        "bun",
        ["install", "--lockfile-only"],
        {
          nodeOptions: { cwd: path.dirname(lockPath) },
        },
      );
    });

    it("finds package-lock.json and runs npm install --package-lock-only", async () => {
      const lockPath = path.join("/workspace", "package-lock.json");
      mockedStat.mockImplementation(async (filePath) => {
        if (String(filePath) === lockPath) return { isFile: () => true } as any;
        throw new Error("ENOENT");
      });
      mockedExec.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });

      const eco = new JsEcosystem(
        path.join("/workspace", "packages", "my-pkg"),
      );
      const result = await eco.syncLockfile();

      expect(result).toBe(lockPath);
      expect(mockedExec).toHaveBeenCalledWith(
        "npm",
        ["install", "--package-lock-only"],
        { nodeOptions: { cwd: path.dirname(lockPath) } },
      );
    });

    it("finds pnpm-lock.yaml and runs pnpm install --lockfile-only", async () => {
      const lockPath = path.join("/workspace", "pnpm-lock.yaml");
      mockedStat.mockImplementation(async (filePath) => {
        if (String(filePath) === lockPath) return { isFile: () => true } as any;
        throw new Error("ENOENT");
      });
      mockedExec.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });

      const eco = new JsEcosystem(
        path.join("/workspace", "packages", "my-pkg"),
      );
      const result = await eco.syncLockfile();

      expect(result).toBe(lockPath);
      expect(mockedExec).toHaveBeenCalledWith(
        "pnpm",
        ["install", "--lockfile-only"],
        { nodeOptions: { cwd: path.dirname(lockPath) } },
      );
    });

    it("detects yarn v1 (no .yarnrc.yml) and runs yarn install", async () => {
      const lockPath = path.join("/workspace", "yarn.lock");
      mockedStat.mockImplementation(async (filePath) => {
        const p = String(filePath);
        if (p === lockPath) return { isFile: () => true } as any;
        throw new Error("ENOENT");
      });
      mockedExec.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });

      const eco = new JsEcosystem(
        path.join("/workspace", "packages", "my-pkg"),
      );
      const result = await eco.syncLockfile();

      expect(result).toBe(lockPath);
      expect(mockedExec).toHaveBeenCalledWith("yarn", ["install"], {
        nodeOptions: { cwd: path.dirname(lockPath) },
      });
    });

    it("detects yarn v2+ (.yarnrc.yml exists) and runs yarn install --mode update-lockfile", async () => {
      const lockPath = path.join("/workspace", "yarn.lock");
      const yarnrcPath = path.join("/workspace", ".yarnrc.yml");
      mockedStat.mockImplementation(async (filePath) => {
        const p = String(filePath);
        if (p === lockPath || p === yarnrcPath)
          return { isFile: () => true } as any;
        throw new Error("ENOENT");
      });
      mockedExec.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });

      const eco = new JsEcosystem(
        path.join("/workspace", "packages", "my-pkg"),
      );
      const result = await eco.syncLockfile();

      expect(result).toBe(lockPath);
      expect(mockedExec).toHaveBeenCalledWith(
        "yarn",
        ["install", "--mode", "update-lockfile"],
        { nodeOptions: { cwd: path.dirname(lockPath) } },
      );
    });

    it("returns undefined when no lock file is found", async () => {
      mockedStat.mockRejectedValue(new Error("ENOENT"));

      const eco = new JsEcosystem(
        path.join("/workspace", "packages", "my-pkg"),
      );
      const result = await eco.syncLockfile();

      expect(result).toBeUndefined();
      expect(mockedExec).not.toHaveBeenCalled();
    });

    it("warns and returns undefined on failure in optional mode", async () => {
      const lockPath = path.join("/workspace", "bun.lock");
      mockedStat.mockImplementation(async (filePath) => {
        if (String(filePath) === lockPath) return { isFile: () => true } as any;
        throw new Error("ENOENT");
      });
      mockedExec.mockRejectedValue(new Error("bun not found"));
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const eco = new JsEcosystem(
        path.join("/workspace", "packages", "my-pkg"),
      );
      const result = await eco.syncLockfile("optional");

      expect(result).toBeUndefined();
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it("throws on failure in required mode", async () => {
      const lockPath = path.join("/workspace", "bun.lock");
      mockedStat.mockImplementation(async (filePath) => {
        if (String(filePath) === lockPath) return { isFile: () => true } as any;
        throw new Error("ENOENT");
      });
      mockedExec.mockRejectedValue(new Error("bun not found"));

      const eco = new JsEcosystem(
        path.join("/workspace", "packages", "my-pkg"),
      );
      await expect(eco.syncLockfile("required")).rejects.toThrow(
        "bun not found",
      );
    });
  });

  describe("resolvePublishDependencies", () => {
    it("returns empty map when package.json doesn't exist", async () => {
      mockedExistsSync.mockReturnValue(false);

      const eco = new JsEcosystem(pkgPath);
      const result = await eco.resolvePublishDependencies(new Map());

      expect(result.size).toBe(0);
      expect(mockedReadFileSync).not.toHaveBeenCalled();
    });

    it("returns empty map when no workspace: deps", async () => {
      mockedExistsSync.mockReturnValue(true);
      mockedReadFileSync.mockReturnValue(
        JSON.stringify({
          name: "my-pkg",
          version: "1.0.0",
          dependencies: { lodash: "^4.0.0" },
        }),
      );

      const eco = new JsEcosystem(pkgPath);
      const result = await eco.resolvePublishDependencies(new Map());

      expect(result.size).toBe(0);
      expect(mockedWriteFileSync).not.toHaveBeenCalled();
    });

    it("resolves workspace:* to exact version", async () => {
      mockedExistsSync.mockReturnValue(true);
      mockedReadFileSync.mockReturnValue(
        JSON.stringify({
          name: "my-pkg",
          version: "1.0.0",
          dependencies: { "dep-a": "workspace:*" },
        }),
      );

      const eco = new JsEcosystem(pkgPath);
      const versions = new Map([["dep-a", "2.0.0"]]);
      const result = await eco.resolvePublishDependencies(versions);

      expect(mockedWriteFileSync).toHaveBeenCalled();
      const written = JSON.parse(
        mockedWriteFileSync.mock.calls[0][1] as string,
      );
      expect(written.dependencies["dep-a"]).toBe("2.0.0");
      expect(result.size).toBe(1);
    });

    it("resolves workspace:^ to caret version", async () => {
      mockedExistsSync.mockReturnValue(true);
      mockedReadFileSync.mockReturnValue(
        JSON.stringify({
          name: "my-pkg",
          version: "1.0.0",
          dependencies: { "dep-a": "workspace:^" },
        }),
      );

      const eco = new JsEcosystem(pkgPath);
      const versions = new Map([["dep-a", "3.1.0"]]);
      const result = await eco.resolvePublishDependencies(versions);

      expect(mockedWriteFileSync).toHaveBeenCalled();
      const written = JSON.parse(
        mockedWriteFileSync.mock.calls[0][1] as string,
      );
      expect(written.dependencies["dep-a"]).toBe("^3.1.0");
      expect(result.size).toBe(1);
    });

    it("resolves workspace:~ to tilde version", async () => {
      mockedExistsSync.mockReturnValue(true);
      mockedReadFileSync.mockReturnValue(
        JSON.stringify({
          name: "my-pkg",
          version: "1.0.0",
          dependencies: { "dep-a": "workspace:~" },
        }),
      );

      const eco = new JsEcosystem(pkgPath);
      const versions = new Map([["dep-a", "1.5.0"]]);
      const result = await eco.resolvePublishDependencies(versions);

      expect(mockedWriteFileSync).toHaveBeenCalled();
      const written = JSON.parse(
        mockedWriteFileSync.mock.calls[0][1] as string,
      );
      expect(written.dependencies["dep-a"]).toBe("~1.5.0");
      expect(result.size).toBe(1);
    });

    it("resolves bare workspace range (e.g. workspace:^1.0.0)", async () => {
      mockedExistsSync.mockReturnValue(true);
      mockedReadFileSync.mockReturnValue(
        JSON.stringify({
          name: "my-pkg",
          version: "1.0.0",
          dependencies: { "dep-a": "workspace:^1.0.0" },
        }),
      );

      const eco = new JsEcosystem(pkgPath);
      const result = await eco.resolvePublishDependencies(new Map());

      expect(mockedWriteFileSync).toHaveBeenCalled();
      const written = JSON.parse(
        mockedWriteFileSync.mock.calls[0][1] as string,
      );
      expect(written.dependencies["dep-a"]).toBe("^1.0.0");
      expect(result.size).toBe(1);
    });

    it("creates backup and writes modified package.json", async () => {
      const originalContent = JSON.stringify({
        name: "my-pkg",
        version: "1.0.0",
        dependencies: { "dep-a": "workspace:*" },
      });
      mockedExistsSync.mockReturnValue(true);
      mockedReadFileSync.mockReturnValue(originalContent);

      const eco = new JsEcosystem(pkgPath);
      const versions = new Map([["dep-a", "2.0.0"]]);
      const result = await eco.resolvePublishDependencies(versions);

      const manifestPath = path.join(pkgPath, "package.json");
      expect(result.get(manifestPath)).toBe(originalContent);
      expect(mockedWriteFileSync).toHaveBeenCalledWith(
        manifestPath,
        expect.any(String),
        "utf-8",
      );
    });

    it("throws when workspace version not found for workspace:*", async () => {
      mockedExistsSync.mockReturnValue(true);
      mockedReadFileSync.mockReturnValue(
        JSON.stringify({
          name: "my-pkg",
          version: "1.0.0",
          dependencies: { "unknown-dep": "workspace:*" },
        }),
      );

      const eco = new JsEcosystem(pkgPath);
      await expect(eco.resolvePublishDependencies(new Map())).rejects.toThrow(
        'Cannot resolve "workspace:*" for dependency "unknown-dep": package not found in workspace',
      );
    });

    it("handles multiple dependency fields", async () => {
      mockedExistsSync.mockReturnValue(true);
      mockedReadFileSync.mockReturnValue(
        JSON.stringify({
          name: "my-pkg",
          version: "1.0.0",
          devDependencies: { "dev-dep": "workspace:^" },
          optionalDependencies: { "opt-dep": "workspace:~" },
        }),
      );

      const eco = new JsEcosystem(pkgPath);
      const versions = new Map([
        ["dev-dep", "1.0.0"],
        ["opt-dep", "2.0.0"],
      ]);
      const result = await eco.resolvePublishDependencies(versions);

      expect(mockedWriteFileSync).toHaveBeenCalled();
      const written = JSON.parse(
        mockedWriteFileSync.mock.calls[0][1] as string,
      );
      expect(written.devDependencies["dev-dep"]).toBe("^1.0.0");
      expect(written.optionalDependencies["opt-dep"]).toBe("~2.0.0");
      expect(result.size).toBe(1);
    });

    it("skips dependency fields that don't exist", async () => {
      mockedExistsSync.mockReturnValue(true);
      mockedReadFileSync.mockReturnValue(
        JSON.stringify({
          name: "my-pkg",
          version: "1.0.0",
        }),
      );

      const eco = new JsEcosystem(pkgPath);
      const result = await eco.resolvePublishDependencies(new Map());

      expect(result.size).toBe(0);
      expect(mockedWriteFileSync).not.toHaveBeenCalled();
    });
  });
});
