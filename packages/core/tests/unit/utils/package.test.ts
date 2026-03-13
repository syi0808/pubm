import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  stat: vi.fn(),
}));

vi.mock("../../../src/ecosystem/rust.js", () => ({
  RustEcosystem: vi.fn().mockImplementation(function () {
    return {
      writeVersion: vi.fn().mockResolvedValue(undefined),
      syncLockfile: vi.fn().mockResolvedValue(undefined),
    };
  }),
}));

// Suppress console.log output from the module (e.g. warningBadge messages)
vi.spyOn(console, "log").mockImplementation(() => {});

async function getFsMocks() {
  const { readFile, stat, writeFile } = await import("node:fs/promises");
  return {
    mockReadFile: vi.mocked(readFile),
    mockStat: vi.mocked(stat),
    mockWriteFile: vi.mocked(writeFile),
  };
}

async function freshImport() {
  vi.clearAllMocks();
  vi.resetModules();
  return await import("../../../src/utils/package.js");
}

describe("findOutFile", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("finds a file in the current working directory", async () => {
    const { mockStat } = await getFsMocks();
    const { findOutFile } = await freshImport();

    mockStat.mockImplementation(async (filePath) => {
      if (filePath === path.join("/projects/my-app", "package.json")) {
        return { isFile: () => true } as any;
      }
      throw new Error("ENOENT");
    });

    const result = await findOutFile("package.json", {
      cwd: "/projects/my-app",
    });
    expect(result).toBe(path.join("/projects/my-app", "package.json"));
  });

  it("finds a file in a parent directory", async () => {
    const { mockStat } = await getFsMocks();
    const { findOutFile } = await freshImport();

    mockStat.mockImplementation(async (filePath) => {
      if (filePath === path.join("/projects", "package.json")) {
        return { isFile: () => true } as any;
      }
      throw new Error("ENOENT");
    });

    const result = await findOutFile("package.json", {
      cwd: "/projects/my-app",
    });
    expect(result).toBe(path.join("/projects", "package.json"));
  });

  it("returns null when the file is not found anywhere up to root", async () => {
    const { mockStat } = await getFsMocks();
    const { findOutFile } = await freshImport();

    mockStat.mockRejectedValue(new Error("ENOENT"));

    const result = await findOutFile("nonexistent.json", {
      cwd: "/projects/my-app",
    });
    expect(result).toBeNull();
  });

  it("uses process.cwd() as default cwd", async () => {
    const { mockStat } = await getFsMocks();
    const { findOutFile } = await freshImport();
    const cwd = process.cwd();

    mockStat.mockImplementation(async (filePath) => {
      if (filePath === path.join(cwd, "package.json")) {
        return { isFile: () => true } as any;
      }
      throw new Error("ENOENT");
    });

    const result = await findOutFile("package.json");
    expect(result).toBe(path.join(cwd, "package.json"));
  });

  it("skips entries where stat resolves but isFile() returns false", async () => {
    const { mockStat } = await getFsMocks();
    const { findOutFile } = await freshImport();

    mockStat.mockImplementation(async (filePath) => {
      // In /projects/my-app it exists but is a directory
      if (filePath === path.join("/projects/my-app", "target")) {
        return { isFile: () => false } as any;
      }
      // In /projects it is an actual file
      if (filePath === path.join("/projects", "target")) {
        return { isFile: () => true } as any;
      }
      throw new Error("ENOENT");
    });

    const result = await findOutFile("target", { cwd: "/projects/my-app" });
    expect(result).toBe(path.join("/projects", "target"));
  });
});

describe("getPackageJson", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("reads and parses package.json", async () => {
    const { mockReadFile, mockStat } = await getFsMocks();
    const { getPackageJson } = await freshImport();
    const cwd = process.cwd();

    const packageData = { name: "my-pkg", version: "1.0.0" };

    mockStat.mockImplementation(async (filePath) => {
      if (filePath === path.join(cwd, "package.json")) {
        return { isFile: () => true } as any;
      }
      throw new Error("ENOENT");
    });

    mockReadFile.mockResolvedValue(Buffer.from(JSON.stringify(packageData)));

    const result = await getPackageJson();
    expect(result).toEqual(packageData);
  });

  it("respects the provided cwd when reading package.json", async () => {
    const { mockReadFile, mockStat } = await getFsMocks();
    const { getPackageJson } = await freshImport();
    const cwd = "/custom/workspace/packages/core";

    const packageData = { name: "@scope/core", version: "1.2.3" };

    mockStat.mockImplementation(async (filePath) => {
      if (filePath === path.join(cwd, "package.json")) {
        return { isFile: () => true } as any;
      }
      throw new Error("ENOENT");
    });

    mockReadFile.mockResolvedValue(Buffer.from(JSON.stringify(packageData)));

    const result = await getPackageJson({ cwd });

    expect(result).toEqual(packageData);
    expect(mockReadFile).toHaveBeenCalledWith(path.join(cwd, "package.json"));
  });

  it("returns cached result on second call", async () => {
    const { mockReadFile, mockStat } = await getFsMocks();
    const { getPackageJson } = await freshImport();
    const cwd = process.cwd();

    const packageData = { name: "my-pkg", version: "1.0.0" };

    mockStat.mockImplementation(async (filePath) => {
      if (filePath === path.join(cwd, "package.json")) {
        return { isFile: () => true } as any;
      }
      throw new Error("ENOENT");
    });

    mockReadFile.mockResolvedValue(Buffer.from(JSON.stringify(packageData)));

    const first = await getPackageJson();
    const second = await getPackageJson();

    expect(first).toEqual(second);
    // readFile should only be called once due to caching
    expect(mockReadFile).toHaveBeenCalledTimes(1);
  });

  it("falls back to jsrJsonToPackageJson when no package.json and fallbackJsr is true", async () => {
    const { mockReadFile, mockStat } = await getFsMocks();
    const { getPackageJson } = await freshImport();

    const jsrData = {
      name: "@scope/my-pkg",
      version: "2.0.0",
      exports: "./mod.ts",
    };

    // package.json not found
    mockStat.mockImplementation(async (filePath) => {
      if (String(filePath).endsWith("jsr.json")) {
        return { isFile: () => true } as any;
      }
      throw new Error("ENOENT");
    });

    mockReadFile.mockResolvedValue(Buffer.from(JSON.stringify(jsrData)));

    const result = await getPackageJson({ fallbackJsr: true });
    expect(result.name).toBe("@scope/my-pkg");
    expect(result.version).toBe("2.0.0");
  });

  it("throws when no package.json and fallbackJsr is false", async () => {
    const { mockStat } = await getFsMocks();
    const { getPackageJson } = await freshImport();

    mockStat.mockRejectedValue(new Error("ENOENT"));

    await expect(getPackageJson({ fallbackJsr: false })).rejects.toThrow();
  });

  it("throws AbstractError on invalid JSON", async () => {
    const { mockReadFile, mockStat } = await getFsMocks();
    const { getPackageJson } = await freshImport();
    const cwd = process.cwd();

    mockStat.mockImplementation(async (filePath) => {
      if (filePath === path.join(cwd, "package.json")) {
        return { isFile: () => true } as any;
      }
      throw new Error("ENOENT");
    });

    mockReadFile.mockResolvedValue(Buffer.from("{ invalid json }"));

    await expect(getPackageJson()).rejects.toThrow(
      "The root package.json is not in valid JSON format",
    );
  });
});

describe("getJsrJson", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("reads and parses jsr.json", async () => {
    const { mockReadFile, mockStat } = await getFsMocks();
    const { getJsrJson } = await freshImport();
    const cwd = process.cwd();

    const jsrData = {
      name: "@scope/my-pkg",
      version: "1.0.0",
      exports: "./mod.ts",
    };

    mockStat.mockImplementation(async (filePath) => {
      if (filePath === path.join(cwd, "jsr.json")) {
        return { isFile: () => true } as any;
      }
      throw new Error("ENOENT");
    });

    mockReadFile.mockResolvedValue(Buffer.from(JSON.stringify(jsrData)));

    const result = await getJsrJson();
    expect(result).toEqual(jsrData);
  });

  it("respects the provided cwd when reading jsr.json", async () => {
    const { mockReadFile, mockStat } = await getFsMocks();
    const { getJsrJson } = await freshImport();
    const cwd = "/custom/workspace/packages/core";

    const jsrData = {
      name: "@scope/core",
      version: "1.2.3",
      exports: "./mod.ts",
    };

    mockStat.mockImplementation(async (filePath) => {
      if (filePath === path.join(cwd, "jsr.json")) {
        return { isFile: () => true } as any;
      }
      throw new Error("ENOENT");
    });

    mockReadFile.mockResolvedValue(Buffer.from(JSON.stringify(jsrData)));

    const result = await getJsrJson({ cwd });

    expect(result).toEqual(jsrData);
    expect(mockReadFile).toHaveBeenCalledWith(path.join(cwd, "jsr.json"));
  });

  it("returns cached result on second call", async () => {
    const { mockReadFile, mockStat } = await getFsMocks();
    const { getJsrJson } = await freshImport();
    const cwd = process.cwd();

    const jsrData = {
      name: "@scope/my-pkg",
      version: "1.0.0",
      exports: "./mod.ts",
    };

    mockStat.mockImplementation(async (filePath) => {
      if (filePath === path.join(cwd, "jsr.json")) {
        return { isFile: () => true } as any;
      }
      throw new Error("ENOENT");
    });

    mockReadFile.mockResolvedValue(Buffer.from(JSON.stringify(jsrData)));

    const first = await getJsrJson();
    const second = await getJsrJson();

    expect(first).toEqual(second);
    expect(mockReadFile).toHaveBeenCalledTimes(1);
  });

  it("falls back to packageJsonToJsrJson when no jsr.json and fallbackPackage is true", async () => {
    const { mockReadFile, mockStat } = await getFsMocks();
    const { getJsrJson } = await freshImport();

    const packageData = {
      name: "my-pkg",
      version: "3.0.0",
      exports: "./index.js",
      files: ["dist"],
    };

    // jsr.json not found, but package.json exists
    mockStat.mockImplementation(async (filePath) => {
      if (String(filePath).endsWith("package.json")) {
        return { isFile: () => true } as any;
      }
      throw new Error("ENOENT");
    });

    mockReadFile.mockResolvedValue(Buffer.from(JSON.stringify(packageData)));

    const result = await getJsrJson({ fallbackPackage: true });
    expect(result.name).toBe("my-pkg");
    expect(result.version).toBe("3.0.0");
  });

  it("throws when no jsr.json and fallbackPackage is false", async () => {
    const { mockStat } = await getFsMocks();
    const { getJsrJson } = await freshImport();

    mockStat.mockRejectedValue(new Error("ENOENT"));

    await expect(getJsrJson({ fallbackPackage: false })).rejects.toThrow();
  });

  it("throws AbstractError on invalid JSON", async () => {
    const { mockReadFile, mockStat } = await getFsMocks();
    const { getJsrJson } = await freshImport();
    const cwd = process.cwd();

    mockStat.mockImplementation(async (filePath) => {
      if (filePath === path.join(cwd, "jsr.json")) {
        return { isFile: () => true } as any;
      }
      throw new Error("ENOENT");
    });

    mockReadFile.mockResolvedValue(Buffer.from("not valid json"));

    await expect(getJsrJson()).rejects.toThrow(
      "The root jsr.json is not in valid JSON format",
    );
  });
});

describe("packageJsonToJsrJson", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("converts string exports directly", async () => {
    const { mockStat } = await getFsMocks();
    const { packageJsonToJsrJson } = await freshImport();

    // findOutFile for .npmignore and .gitignore should return null
    mockStat.mockRejectedValue(new Error("ENOENT"));

    const result = await packageJsonToJsrJson({
      name: "my-pkg",
      version: "1.0.0",
      exports: "./index.js",
    } as any);

    expect(result.name).toBe("my-pkg");
    expect(result.version).toBe("1.0.0");
    expect(result.exports).toBe("./index.js");
  });

  it("converts object exports by extracting import fields", async () => {
    const { mockStat } = await getFsMocks();
    const { packageJsonToJsrJson } = await freshImport();

    mockStat.mockRejectedValue(new Error("ENOENT"));

    const result = await packageJsonToJsrJson({
      name: "my-pkg",
      version: "1.0.0",
      exports: {
        ".": {
          import: "./dist/index.js",
          require: "./dist/index.cjs",
        },
        "./utils": {
          import: "./dist/utils.js",
        },
      },
    } as any);

    expect(result.exports).toEqual({
      ".": "./dist/index.js",
      "./utils": "./dist/utils.js",
    });
  });

  it("converts files array: normal entries to publish.include, !-prefixed to publish.exclude", async () => {
    const { mockStat } = await getFsMocks();
    const { packageJsonToJsrJson } = await freshImport();

    mockStat.mockRejectedValue(new Error("ENOENT"));

    const result = await packageJsonToJsrJson({
      name: "my-pkg",
      version: "1.0.0",
      files: ["dist", "lib", "!test"],
    } as any);

    expect(result.publish?.include).toEqual(["dist", "lib"]);
    expect(result.publish?.exclude).toEqual(["test"]);
  });

  it("handles missing exports gracefully", async () => {
    const { mockStat } = await getFsMocks();
    const { packageJsonToJsrJson } = await freshImport();

    mockStat.mockRejectedValue(new Error("ENOENT"));

    const result = await packageJsonToJsrJson({
      name: "my-pkg",
      version: "1.0.0",
    } as any);

    expect(result.exports).toBeUndefined();
  });

  it("handles missing files gracefully", async () => {
    const { mockStat } = await getFsMocks();
    const { packageJsonToJsrJson } = await freshImport();

    mockStat.mockRejectedValue(new Error("ENOENT"));

    const result = await packageJsonToJsrJson({
      name: "my-pkg",
      version: "1.0.0",
    } as any);

    expect(result.publish?.include).toEqual([]);
    expect(result.publish?.exclude).toEqual([]);
  });

  it("reads ignore patterns from .npmignore before .gitignore", async () => {
    const { mockReadFile, mockStat } = await getFsMocks();
    const { packageJsonToJsrJson } = await freshImport();

    mockStat.mockImplementation(async (filePath) => {
      if (String(filePath).endsWith(".npmignore")) {
        return { isFile: () => true } as any;
      }
      throw new Error("ENOENT");
    });
    mockReadFile.mockResolvedValue(Buffer.from("coverage\n.tmp\n"));

    const result = await packageJsonToJsrJson({
      name: "my-pkg",
      version: "1.0.0",
      files: ["dist"],
    } as any);

    expect(result.publish?.exclude).toEqual(["coverage", ".tmp"]);
  });

  it("falls back to .gitignore when .npmignore is missing", async () => {
    const { mockReadFile, mockStat } = await getFsMocks();
    const { packageJsonToJsrJson } = await freshImport();

    mockStat.mockImplementation(async (filePath) => {
      if (String(filePath).endsWith(".gitignore")) {
        return { isFile: () => true } as any;
      }
      throw new Error("ENOENT");
    });
    mockReadFile.mockResolvedValue(Buffer.from("dist\nnode_modules\n"));

    const result = await packageJsonToJsrJson({
      name: "my-pkg",
      version: "1.0.0",
    } as any);

    expect(result.publish?.exclude).toEqual(["dist", "node_modules"]);
  });

  it("converts deeply nested object exports recursively", async () => {
    const { mockStat } = await getFsMocks();
    const { packageJsonToJsrJson } = await freshImport();

    mockStat.mockRejectedValue(new Error("ENOENT"));

    const result = await packageJsonToJsrJson({
      name: "my-pkg",
      version: "1.0.0",
      exports: {
        ".": {
          import: {
            types: "./dist/index.d.ts",
            default: "./dist/index.js",
          },
        },
      },
    } as any);

    // The nested object under import should be recursively converted
    expect(result.exports).toEqual({
      ".": {
        types: "./dist/index.d.ts",
        default: "./dist/index.js",
      },
    });
  });
});

describe("jsrJsonToPackageJson", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("converts string exports directly", async () => {
    const { jsrJsonToPackageJson } = await freshImport();

    const result = jsrJsonToPackageJson({
      name: "@scope/my-pkg",
      version: "1.0.0",
      exports: "./mod.ts",
    });

    expect(result.name).toBe("@scope/my-pkg");
    expect(result.version).toBe("1.0.0");
    expect(result.exports).toBe("./mod.ts");
  });

  it("converts object exports by wrapping values in { import: ... }", async () => {
    const { jsrJsonToPackageJson } = await freshImport();

    const result = jsrJsonToPackageJson({
      name: "@scope/my-pkg",
      version: "1.0.0",
      exports: {
        ".": "./mod.ts",
        "./utils": "./utils.ts",
      },
    });

    expect(result.exports).toEqual({
      ".": { import: "./mod.ts" },
      "./utils": { import: "./utils.ts" },
    });
  });

  it("converts publish.include and publish.exclude into files array", async () => {
    const { jsrJsonToPackageJson } = await freshImport();

    const result = jsrJsonToPackageJson({
      name: "@scope/my-pkg",
      version: "1.0.0",
      exports: "./mod.ts",
      publish: {
        include: ["src", "lib"],
        exclude: ["tests", "docs"],
      },
    });

    expect(result.files).toEqual(["src", "lib", "!tests", "!docs"]);
  });

  it("handles missing publish field", async () => {
    const { jsrJsonToPackageJson } = await freshImport();

    const result = jsrJsonToPackageJson({
      name: "@scope/my-pkg",
      version: "1.0.0",
      exports: "./mod.ts",
    });

    expect(result.files).toEqual([]);
  });

  it("handles missing exports", async () => {
    const { jsrJsonToPackageJson } = await freshImport();

    const result = jsrJsonToPackageJson({
      name: "@scope/my-pkg",
      version: "1.0.0",
      exports: undefined as any,
    });

    expect(result.exports).toBeUndefined();
  });
});

describe("version", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("returns version from package.json", async () => {
    const { mockReadFile, mockStat } = await getFsMocks();
    const { version } = await freshImport();
    const cwd = process.cwd();

    mockStat.mockImplementation(async (filePath) => {
      if (filePath === path.join(cwd, "package.json")) {
        return { isFile: () => true } as any;
      }
      throw new Error("ENOENT");
    });

    mockReadFile.mockResolvedValue(
      Buffer.from(JSON.stringify({ name: "my-pkg", version: "4.2.0" })),
    );

    const result = await version();
    expect(result).toBe("4.2.0");
  });

  it("falls back to jsr.json when package.json has no version", async () => {
    const { mockReadFile, mockStat } = await getFsMocks();
    const { version } = await freshImport();

    mockStat.mockImplementation(async (filePath) => {
      const fp = String(filePath);
      if (fp.endsWith("package.json") || fp.endsWith("jsr.json")) {
        return { isFile: () => true } as any;
      }
      throw new Error("ENOENT");
    });

    mockReadFile.mockImplementation(async (filePath) => {
      const fp = String(filePath);
      if (fp.endsWith("package.json")) {
        return Buffer.from(JSON.stringify({ name: "my-pkg" }));
      }
      if (fp.endsWith("jsr.json")) {
        return Buffer.from(
          JSON.stringify({
            name: "@scope/my-pkg",
            version: "5.0.0",
            exports: "./mod.ts",
          }),
        );
      }
      throw new Error("ENOENT");
    });

    const result = await version();
    expect(result).toBe("5.0.0");
  });

  it("throws when neither package.json nor jsr.json have a version", async () => {
    const { mockReadFile, mockStat } = await getFsMocks();
    const { version } = await freshImport();

    mockStat.mockImplementation(async (filePath) => {
      const fp = String(filePath);
      if (fp.endsWith("package.json") || fp.endsWith("jsr.json")) {
        return { isFile: () => true } as any;
      }
      throw new Error("ENOENT");
    });

    mockReadFile.mockImplementation(async (filePath) => {
      const fp = String(filePath);
      if (fp.endsWith("package.json")) {
        return Buffer.from(JSON.stringify({ name: "my-pkg" }));
      }
      if (fp.endsWith("jsr.json")) {
        return Buffer.from(
          JSON.stringify({ name: "@scope/my-pkg", exports: "./mod.ts" }),
        );
      }
      throw new Error("ENOENT");
    });

    await expect(version()).rejects.toThrow(
      "Can't find either package.json or jsr.json",
    );
  });
});

describe("replaceVersion", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("replaces version in both package.json and jsr.json", async () => {
    const { mockReadFile, mockStat, mockWriteFile } = await getFsMocks();
    const { replaceVersion } = await freshImport();

    mockStat.mockImplementation(async (filePath) => {
      const fp = String(filePath);
      if (fp.endsWith("package.json") || fp.endsWith("jsr.json")) {
        return { isFile: () => true } as any;
      }
      throw new Error("ENOENT");
    });

    mockReadFile.mockImplementation(async (filePath) => {
      const fp = String(filePath);
      if (fp.endsWith("package.json")) {
        return Buffer.from('{\n  "version": "1.0.0"\n}');
      }
      if (fp.endsWith("jsr.json")) {
        return Buffer.from('{\n  "version": "1.0.0"\n}');
      }
      throw new Error("ENOENT");
    });

    mockWriteFile.mockResolvedValue(undefined);

    const result = await replaceVersion("2.0.0");

    expect(result).toContain("package.json");
    expect(result).toContain("jsr.json");
    expect(mockWriteFile).toHaveBeenCalledTimes(2);

    // Check that the written content has the new version
    const writeArgs = mockWriteFile.mock.calls;
    for (const call of writeArgs) {
      expect(String(call[1])).toContain('"version": "2.0.0"');
    }
  });

  it("skips missing files and only returns found filenames", async () => {
    const { mockReadFile, mockStat, mockWriteFile } = await getFsMocks();
    const { replaceVersion } = await freshImport();

    // Only package.json exists
    mockStat.mockImplementation(async (filePath) => {
      if (String(filePath).endsWith("package.json")) {
        return { isFile: () => true } as any;
      }
      throw new Error("ENOENT");
    });

    mockReadFile.mockResolvedValue(Buffer.from('{\n  "version": "1.0.0"\n}'));

    mockWriteFile.mockResolvedValue(undefined);

    const result = await replaceVersion("3.0.0");

    expect(result).toEqual(["package.json"]);
    expect(mockWriteFile).toHaveBeenCalledTimes(1);
  });

  it("returns empty array when neither file exists", async () => {
    const { mockStat } = await getFsMocks();
    const { replaceVersion } = await freshImport();

    mockStat.mockRejectedValue(new Error("ENOENT"));

    const result = await replaceVersion("1.0.0");
    expect(result).toEqual([]);
  });

  it("throws AbstractError with context when writeFile fails for package.json", async () => {
    const { mockReadFile, mockStat, mockWriteFile } = await getFsMocks();
    const { replaceVersion } = await freshImport();

    mockStat.mockImplementation(async (filePath) => {
      const fp = String(filePath);
      if (fp.endsWith("package.json")) {
        return { isFile: () => true } as any;
      }
      throw new Error("ENOENT");
    });

    mockReadFile.mockResolvedValue(Buffer.from('{\n  "version": "1.0.0"\n}'));
    mockWriteFile.mockRejectedValue(new Error("EACCES: permission denied"));

    await expect(replaceVersion("2.0.0")).rejects.toThrow(
      /Failed to write version to package\.json/,
    );
  });

  it("throws AbstractError with context when writeFile fails for jsr.json", async () => {
    const { mockReadFile, mockStat, mockWriteFile } = await getFsMocks();
    const { replaceVersion } = await freshImport();

    mockStat.mockImplementation(async (filePath) => {
      const fp = String(filePath);
      if (fp.endsWith("jsr.json")) {
        return { isFile: () => true } as any;
      }
      throw new Error("ENOENT");
    });

    mockReadFile.mockResolvedValue(Buffer.from('{\n  "version": "1.0.0"\n}'));
    mockWriteFile.mockRejectedValue(new Error("EACCES: permission denied"));

    await expect(replaceVersion("2.0.0")).rejects.toThrow(
      /Failed to write version to jsr\.json/,
    );
  });

  it("updates Cargo.toml for crates packages when packages config is provided", async () => {
    const { mockStat } = await getFsMocks();
    const { replaceVersion } = await freshImport();
    const { RustEcosystem } = await import("../../../src/ecosystem/rust.js");

    mockStat.mockRejectedValue(new Error("ENOENT"));

    const mockWriteVersion = vi.fn().mockResolvedValue(undefined);
    vi.mocked(RustEcosystem).mockImplementation(function () {
      return {
        writeVersion: mockWriteVersion,
        syncLockfile: vi.fn().mockResolvedValue(undefined),
      } as any;
    });

    const packages = [
      { path: "rust/crates/my-crate", registries: ["crates"] as any[] },
    ];

    const result = await replaceVersion("2.0.0", packages);

    expect(mockWriteVersion).toHaveBeenCalledWith("2.0.0");
    expect(result).toContain(path.join("rust/crates/my-crate", "Cargo.toml"));
  });

  it("updates multiple Cargo.toml files for multiple crates packages", async () => {
    const { mockStat } = await getFsMocks();
    const { replaceVersion } = await freshImport();
    const { RustEcosystem } = await import("../../../src/ecosystem/rust.js");

    mockStat.mockRejectedValue(new Error("ENOENT"));

    const mockWriteVersion = vi.fn().mockResolvedValue(undefined);
    let callCount = 0;
    vi.mocked(RustEcosystem).mockImplementation(function () {
      return {
        writeVersion: mockWriteVersion,
        syncLockfile: vi.fn().mockResolvedValue(undefined),
        packageName: vi
          .fn()
          .mockImplementation(() =>
            Promise.resolve(`lib-${++callCount === 1 ? "a" : "b"}`),
          ),
        updateSiblingDependencyVersions: vi.fn().mockResolvedValue(false),
      } as any;
    });

    const packages = [
      { path: ".", registries: ["npm", "jsr"] as any[] },
      { path: "rust/crates/lib-a", registries: ["crates"] as any[] },
      { path: "rust/crates/lib-b", registries: ["crates"] as any[] },
    ];

    const result = await replaceVersion("3.0.0", packages);

    expect(mockWriteVersion).toHaveBeenCalledTimes(2);
    expect(result).toContain(path.join("rust/crates/lib-a", "Cargo.toml"));
    expect(result).toContain(path.join("rust/crates/lib-b", "Cargo.toml"));
  });

  it("skips non-crates packages when updating Cargo.toml", async () => {
    const { mockStat } = await getFsMocks();
    const { replaceVersion } = await freshImport();
    const { RustEcosystem } = await import("../../../src/ecosystem/rust.js");

    mockStat.mockRejectedValue(new Error("ENOENT"));

    const mockWriteVersion = vi.fn().mockResolvedValue(undefined);
    vi.mocked(RustEcosystem).mockImplementation(function () {
      return {
        writeVersion: mockWriteVersion,
        syncLockfile: vi.fn().mockResolvedValue(undefined),
      } as any;
    });

    const packages = [{ path: ".", registries: ["npm", "jsr"] as any[] }];

    const result = await replaceVersion("2.0.0", packages);

    expect(mockWriteVersion).not.toHaveBeenCalled();
    expect(result).not.toContain(expect.stringContaining("Cargo.toml"));
  });

  it("throws when Cargo.toml write fails", async () => {
    const { mockStat } = await getFsMocks();
    const { replaceVersion } = await freshImport();
    const { RustEcosystem } = await import("../../../src/ecosystem/rust.js");

    mockStat.mockRejectedValue(new Error("ENOENT"));

    vi.mocked(RustEcosystem).mockImplementation(function () {
      return {
        writeVersion: vi
          .fn()
          .mockRejectedValue(new Error("EACCES: permission denied")),
        syncLockfile: vi.fn().mockResolvedValue(undefined),
      } as any;
    });

    const packages = [
      { path: "rust/crates/my-crate", registries: ["crates"] as any[] },
    ];

    await expect(replaceVersion("2.0.0", packages)).rejects.toThrow(
      /Failed to write version to Cargo\.toml at rust\/crates\/my-crate/,
    );
  });

  it("handles mixed JS and Rust packages together", async () => {
    const { mockReadFile, mockStat, mockWriteFile } = await getFsMocks();
    const { replaceVersion } = await freshImport();
    const { RustEcosystem } = await import("../../../src/ecosystem/rust.js");

    mockStat.mockImplementation(async (filePath) => {
      const fp = String(filePath);
      if (fp.endsWith("package.json")) {
        return { isFile: () => true } as any;
      }
      throw new Error("ENOENT");
    });

    mockReadFile.mockResolvedValue(Buffer.from('{\n  "version": "1.0.0"\n}'));
    mockWriteFile.mockResolvedValue(undefined);

    const mockWriteVersion = vi.fn().mockResolvedValue(undefined);
    vi.mocked(RustEcosystem).mockImplementation(function () {
      return {
        writeVersion: mockWriteVersion,
        syncLockfile: vi.fn().mockResolvedValue(undefined),
      } as any;
    });

    const packages = [
      { path: ".", registries: ["npm", "jsr"] as any[] },
      { path: "rust/crates/my-crate", registries: ["crates"] as any[] },
    ];

    const result = await replaceVersion("2.0.0", packages);

    expect(result).toContain("package.json");
    expect(result).toContain(path.join("rust/crates/my-crate", "Cargo.toml"));
    expect(mockWriteVersion).toHaveBeenCalledWith("2.0.0");
  });

  it("includes Cargo.lock path when syncLockfile returns a path", async () => {
    const { mockStat } = await getFsMocks();
    const { replaceVersion } = await freshImport();
    const { RustEcosystem } = await import("../../../src/ecosystem/rust.js");

    mockStat.mockRejectedValue(new Error("ENOENT"));

    const mockWriteVersion = vi.fn().mockResolvedValue(undefined);
    const lockfilePath = path.resolve("rust/Cargo.lock");
    vi.mocked(RustEcosystem).mockImplementation(function () {
      return {
        writeVersion: mockWriteVersion,
        syncLockfile: vi.fn().mockResolvedValue(lockfilePath),
      } as any;
    });

    const packages = [
      { path: "rust/crates/my-crate", registries: ["crates"] as any[] },
    ];

    const result = await replaceVersion("2.0.0", packages);

    expect(result).toContain(path.join("rust/crates/my-crate", "Cargo.toml"));
    expect(result).toContain(lockfilePath);
  });

  it("deduplicates Cargo.lock when multiple crates share a workspace", async () => {
    const { mockStat } = await getFsMocks();
    const { replaceVersion } = await freshImport();
    const { RustEcosystem } = await import("../../../src/ecosystem/rust.js");

    mockStat.mockRejectedValue(new Error("ENOENT"));

    const lockfilePath = path.resolve("rust/Cargo.lock");
    let callCount = 0;
    vi.mocked(RustEcosystem).mockImplementation(function () {
      return {
        writeVersion: vi.fn().mockResolvedValue(undefined),
        syncLockfile: vi.fn().mockResolvedValue(lockfilePath),
        packageName: vi
          .fn()
          .mockImplementation(() =>
            Promise.resolve(`crate-${++callCount === 1 ? "a" : "b"}`),
          ),
        updateSiblingDependencyVersions: vi.fn().mockResolvedValue(false),
      } as any;
    });

    const packages = [
      { path: "rust/crates/crate-a", registries: ["crates"] as any[] },
      { path: "rust/crates/crate-b", registries: ["crates"] as any[] },
    ];

    const result = await replaceVersion("2.0.0", packages);

    const lockfileCount = result.filter((f) => f === lockfilePath).length;
    expect(lockfileCount).toBe(1);
  });

  it("does not process Cargo.toml when packages is undefined", async () => {
    const { mockStat } = await getFsMocks();
    const { replaceVersion } = await freshImport();
    const { RustEcosystem } = await import("../../../src/ecosystem/rust.js");

    mockStat.mockRejectedValue(new Error("ENOENT"));

    const mockWriteVersion = vi.fn();
    vi.mocked(RustEcosystem).mockImplementation(function () {
      return {
        writeVersion: mockWriteVersion,
        syncLockfile: vi.fn().mockResolvedValue(undefined),
      } as any;
    });

    await replaceVersion("1.0.0");

    expect(mockWriteVersion).not.toHaveBeenCalled();
  });
});

describe("patchCachedJsrJson", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("merges contents into the cached jsr json", async () => {
    const { mockReadFile, mockStat } = await getFsMocks();
    const { getJsrJson, patchCachedJsrJson } = await freshImport();
    const cwd = process.cwd();

    const jsrData = {
      name: "@scope/my-pkg",
      version: "1.0.0",
      exports: "./mod.ts",
    };

    mockStat.mockImplementation(async (filePath) => {
      if (filePath === path.join(cwd, "jsr.json")) {
        return { isFile: () => true } as any;
      }
      throw new Error("ENOENT");
    });

    mockReadFile.mockResolvedValue(Buffer.from(JSON.stringify(jsrData)));

    // Populate the cache
    await getJsrJson();

    // Patch the cached value
    patchCachedJsrJson({ name: "@other/name" });

    // Should return the patched value from cache
    const result = await getJsrJson();
    expect(result.name).toBe("@other/name");
    expect(result.version).toBe("1.0.0");
    expect(result.exports).toBe("./mod.ts");
  });

  it("creates a cache entry even if none existed before", async () => {
    const { patchCachedJsrJson, getJsrJson } = await freshImport();

    patchCachedJsrJson(
      { name: "@new/pkg", version: "0.1.0", exports: "./index.ts" },
      { cwd: "/custom/path" },
    );

    // getJsrJson with that cwd should return the cached value
    const result = await getJsrJson({ cwd: "/custom/path" });
    expect(result.name).toBe("@new/pkg");
    expect(result.version).toBe("0.1.0");
  });
});

describe("replaceVersionAtPath", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("updates both package.json and jsr.json for a package path", async () => {
    const { mockReadFile, mockWriteFile } = await getFsMocks();
    const { replaceVersionAtPath } = await freshImport();

    mockReadFile.mockImplementation(async (filePath) => {
      if (
        String(filePath).endsWith("package.json") ||
        String(filePath).endsWith("jsr.json")
      ) {
        return Buffer.from('{\n  "version": "1.0.0"\n}');
      }
      throw new Error("ENOENT");
    });
    mockWriteFile.mockResolvedValue(undefined);

    const result = await replaceVersionAtPath("2.0.0", "/repo/packages/core");

    expect(result).toEqual([
      path.join("/repo/packages/core", "package.json"),
      path.join("/repo/packages/core", "jsr.json"),
    ]);
    expect(mockWriteFile).toHaveBeenCalledTimes(2);
  });

  it("ignores missing manifest files at a package path", async () => {
    const { mockReadFile } = await getFsMocks();
    const { replaceVersionAtPath } = await freshImport();

    mockReadFile.mockRejectedValue(new Error("ENOENT"));

    await expect(
      replaceVersionAtPath("2.0.0", "/repo/packages/core"),
    ).resolves.toEqual([]);
  });
});

describe("replaceVersions", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("applies per-package versions based on package.json names", async () => {
    const { mockReadFile, mockWriteFile } = await getFsMocks();
    const { replaceVersions } = await freshImport();

    mockReadFile.mockImplementation(async (filePath) => {
      const normalized = String(filePath);
      if (normalized.endsWith("packages/core/package.json")) {
        return Buffer.from(
          JSON.stringify({ name: "@pubm/core", version: "1.0.0" }),
        );
      }
      if (normalized.endsWith("packages/pubm/package.json")) {
        return Buffer.from(JSON.stringify({ name: "pubm", version: "1.0.0" }));
      }
      throw new Error("ENOENT");
    });
    mockWriteFile.mockResolvedValue(undefined);

    const result = await replaceVersions(
      new Map([
        ["@pubm/core", "2.0.0"],
        ["pubm", "3.0.0"],
      ]),
      [
        { path: "packages/core", registries: ["npm"] as any[] },
        { path: "packages/pubm", registries: ["jsr"] as any[] },
      ] as any,
    );

    expect(result).toContain(
      path.resolve("packages/core", "package.json"),
    );
    expect(result).toContain(
      path.resolve("packages/pubm", "package.json"),
    );
    expect(String(mockWriteFile.mock.calls[0]?.[1])).toContain(
      '"version":"2.0.0"',
    );
    expect(String(mockWriteFile.mock.calls[1]?.[1])).toContain(
      '"version":"3.0.0"',
    );
  });
});
