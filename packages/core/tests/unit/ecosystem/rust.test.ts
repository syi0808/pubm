import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  stat: vi.fn(),
}));
vi.mock("../../../src/utils/exec.js", () => ({
  exec: vi.fn(),
}));

import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { RustEcosystem } from "../../../src/ecosystem/rust.js";
import { RustEcosystemDescriptor } from "../../../src/ecosystem/rust-descriptor.js";
import { CratesPackageRegistry } from "../../../src/registry/crates.js";
import { exec } from "../../../src/utils/exec.js";

const mockedReadFile = vi.mocked(readFile);
const mockedWriteFile = vi.mocked(writeFile);
const mockedStat = vi.mocked(stat);
const mockedExec = vi.mocked(exec);

beforeEach(() => {
  vi.clearAllMocks();
  CratesPackageRegistry.reader.clearCache();
});

const CARGO_TOML = `[package]
name = "my-crate"
version = "0.1.0"
edition = "2021"

[dependencies]
`;

describe("RustEcosystem", () => {
  const pkgPath = "/fake/crate";

  describe("detect", () => {
    it("returns true when Cargo.toml exists", async () => {
      mockedStat.mockResolvedValue({ isFile: () => true } as any);
      expect(await RustEcosystem.detect(pkgPath)).toBe(true);
    });

    it("returns false when Cargo.toml does not exist", async () => {
      mockedStat.mockRejectedValue(new Error("ENOENT"));
      expect(await RustEcosystem.detect(pkgPath)).toBe(false);
    });
  });

  describe("packageName", () => {
    it("reads name from Cargo.toml", async () => {
      mockedStat.mockResolvedValue({ isFile: () => true } as any);
      mockedReadFile.mockResolvedValue(CARGO_TOML as any);

      const eco = new RustEcosystem(pkgPath);
      expect(await eco.packageName()).toBe("my-crate");
    });
  });

  describe("readVersion", () => {
    it("reads version from Cargo.toml", async () => {
      mockedStat.mockResolvedValue({ isFile: () => true } as any);
      mockedReadFile.mockResolvedValue(CARGO_TOML as any);

      const eco = new RustEcosystem(pkgPath);
      expect(await eco.readVersion()).toBe("0.1.0");
    });
  });

  describe("writeVersion", () => {
    it("replaces version in Cargo.toml", async () => {
      mockedReadFile.mockResolvedValue(CARGO_TOML as any);

      const eco = new RustEcosystem(pkgPath);
      await eco.writeVersion("1.0.0");

      expect(mockedWriteFile).toHaveBeenCalled();
      const written = mockedWriteFile.mock.calls[0][1] as string;
      expect(written).toContain('version = "1.0.0"');
      expect(written).not.toContain('version = "0.1.0"');
    });

    it("does not replace version in dependency sections", async () => {
      const cargoWithDeps = `[package]
name = "my-crate"
version = "0.1.0"
edition = "2021"

[dependencies]
serde = { version = "1.0.0", features = ["derive"] }
`;
      mockedReadFile.mockResolvedValue(cargoWithDeps as any);

      const eco = new RustEcosystem(pkgPath);
      await eco.writeVersion("2.0.0");

      const written = mockedWriteFile.mock.calls[0][1] as string;
      expect(written).toContain('version = "2.0.0"');
      // serde version should remain unchanged
      expect(written).toContain('version = "1.0.0"');
    });
  });

  describe("manifestFiles", () => {
    it("returns Cargo.toml", () => {
      const eco = new RustEcosystem(pkgPath);
      expect(eco.manifestFiles()).toEqual(["Cargo.toml"]);
    });
  });

  describe("defaultTestCommand", () => {
    it("returns cargo test", () => {
      const eco = new RustEcosystem(pkgPath);
      expect(eco.defaultTestCommand()).toBe("cargo test");
    });
  });

  describe("defaultBuildCommand", () => {
    it("returns cargo build --release", () => {
      const eco = new RustEcosystem(pkgPath);
      expect(eco.defaultBuildCommand()).toBe("cargo build --release");
    });
  });

  describe("supportedRegistries", () => {
    it("returns crates", () => {
      const eco = new RustEcosystem(pkgPath);
      expect(eco.supportedRegistries()).toEqual(["crates"]);
    });
  });

  describe("dependencies", () => {
    it("returns dependency names from [dependencies] and [build-dependencies]", async () => {
      const cargoWithDeps = `[package]
name = "my-crate"
version = "0.1.0"

[dependencies]
serde = "1.0"
my-lib = { version = "0.1.0", path = "../my-lib" }

[build-dependencies]
cc = "1.0"
my-build-tool = { path = "../my-build-tool" }

[dev-dependencies]
tokio = "1.0"
`;
      mockedStat.mockResolvedValue({ isFile: () => true } as any);
      mockedReadFile.mockResolvedValue(cargoWithDeps as any);

      const eco = new RustEcosystem(pkgPath);
      const deps = await eco.dependencies();

      expect(deps).toContain("serde");
      expect(deps).toContain("my-lib");
      expect(deps).toContain("cc");
      expect(deps).toContain("my-build-tool");
      expect(deps).not.toContain("tokio");
    });

    it("returns empty array when no dependencies", async () => {
      const cargoNoDeps = `[package]
name = "my-crate"
version = "0.1.0"
`;
      mockedStat.mockResolvedValue({ isFile: () => true } as any);
      mockedReadFile.mockResolvedValue(cargoNoDeps as any);

      const eco = new RustEcosystem(pkgPath);
      expect(await eco.dependencies()).toEqual([]);
    });
  });

  describe("updateSiblingDependencyVersions", () => {
    it("adds version field to path dependencies matching sibling crates", async () => {
      const cargo = `[package]
name = "my-cli"
version = "0.1.0"

[dependencies]
my-lib = { path = "../my-lib" }
serde = "1.0"
`;
      mockedReadFile.mockResolvedValue(cargo as any);

      const eco = new RustEcosystem(pkgPath);
      const siblings = new Map([["my-lib", "2.0.0"]]);
      const modified = await eco.updateSiblingDependencyVersions(siblings);

      expect(modified).toBe(true);
      expect(mockedWriteFile).toHaveBeenCalled();
      const written = mockedWriteFile.mock.calls[0][1] as string;
      expect(written).toContain('version = "2.0.0"');
      expect(written).toContain('path = "../my-lib"');
    });

    it("updates existing version field for sibling path dependencies", async () => {
      const cargo = `[package]
name = "my-cli"
version = "1.0.0"

[dependencies]
my-lib = { version = "0.1.0", path = "../my-lib" }
`;
      mockedReadFile.mockResolvedValue(cargo as any);

      const eco = new RustEcosystem(pkgPath);
      const siblings = new Map([["my-lib", "2.0.0"]]);
      const modified = await eco.updateSiblingDependencyVersions(siblings);

      expect(modified).toBe(true);
      const written = mockedWriteFile.mock.calls[0][1] as string;
      expect(written).toContain('version = "2.0.0"');
      expect(written).not.toContain('version = "0.1.0"');
    });

    it("does not modify non-sibling dependencies", async () => {
      const cargo = `[package]
name = "my-cli"
version = "0.1.0"

[dependencies]
serde = { version = "1.0", features = ["derive"] }
`;
      mockedReadFile.mockResolvedValue(cargo as any);

      const eco = new RustEcosystem(pkgPath);
      const siblings = new Map([["my-lib", "2.0.0"]]);
      const modified = await eco.updateSiblingDependencyVersions(siblings);

      expect(modified).toBe(false);
      expect(mockedWriteFile).not.toHaveBeenCalled();
    });

    it("handles build-dependencies section", async () => {
      const cargo = `[package]
name = "my-cli"
version = "0.1.0"

[build-dependencies]
my-build = { path = "../my-build" }
`;
      mockedReadFile.mockResolvedValue(cargo as any);

      const eco = new RustEcosystem(pkgPath);
      const siblings = new Map([["my-build", "3.0.0"]]);
      const modified = await eco.updateSiblingDependencyVersions(siblings);

      expect(modified).toBe(true);
      const written = mockedWriteFile.mock.calls[0][1] as string;
      expect(written).toContain('version = "3.0.0"');
    });
  });

  describe("syncLockfile", () => {
    it("runs cargo update from the workspace root that owns Cargo.lock", async () => {
      mockedStat.mockImplementation(async (filePath) => {
        const p = String(filePath);
        if (p.endsWith("Cargo.toml")) {
          return { isFile: () => true } as any;
        }
        if (p === path.join("/workspace", "Cargo.lock")) {
          return { isFile: () => true } as any;
        }
        throw new Error("ENOENT");
      });
      mockedReadFile.mockResolvedValue(CARGO_TOML as any);

      const eco = new RustEcosystem(
        path.join("/workspace", "crates", "my-crate"),
      );
      const lockfile = await eco.syncLockfile();

      expect(lockfile).toBe(path.join("/workspace", "Cargo.lock"));
      expect(mockedExec).toHaveBeenCalledWith(
        "cargo",
        ["update", "--package", "my-crate"],
        {
          nodeOptions: {
            cwd: path.dirname(path.join("/workspace", "Cargo.lock")),
          },
        },
      );
    });

    it("returns undefined when no Cargo.lock can be found", async () => {
      mockedStat.mockRejectedValue(new Error("ENOENT"));

      const eco = new RustEcosystem(
        path.join("/workspace", "crates", "my-crate"),
      );
      await expect(eco.syncLockfile()).resolves.toBeUndefined();
      expect(mockedExec).not.toHaveBeenCalled();
    });

    it("returns undefined immediately when mode is skip", async () => {
      const eco = new RustEcosystem(path.join("/workspace", "crates", "my-crate"));
      const result = await eco.syncLockfile("skip");
      expect(result).toBeUndefined();
      expect(mockedExec).not.toHaveBeenCalled();
      expect(mockedStat).not.toHaveBeenCalled();
    });

    it("returns undefined and warns when install fails in optional mode", async () => {
      mockedStat.mockImplementation(async (filePath) => {
        const p = String(filePath);
        if (p.endsWith("Cargo.toml")) return { isFile: () => true } as any;
        if (p === path.join("/workspace", "Cargo.lock"))
          return { isFile: () => true } as any;
        throw new Error("ENOENT");
      });
      mockedReadFile.mockResolvedValue(CARGO_TOML as any);
      mockedExec.mockRejectedValue(new Error("cargo not found"));
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const eco = new RustEcosystem(path.join("/workspace", "crates", "my-crate"));
      const result = await eco.syncLockfile("optional");

      expect(result).toBeUndefined();
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it("throws when install fails in required mode", async () => {
      mockedStat.mockImplementation(async (filePath) => {
        const p = String(filePath);
        if (p.endsWith("Cargo.toml")) return { isFile: () => true } as any;
        if (p === path.join("/workspace", "Cargo.lock"))
          return { isFile: () => true } as any;
        throw new Error("ENOENT");
      });
      mockedReadFile.mockResolvedValue(CARGO_TOML as any);
      mockedExec.mockRejectedValue(new Error("cargo not found"));

      const eco = new RustEcosystem(path.join("/workspace", "crates", "my-crate"));
      await expect(eco.syncLockfile("required")).rejects.toThrow("cargo not found");
    });
  });

  describe("createDescriptor", () => {
    it("returns RustEcosystemDescriptor with cratesName when Cargo.toml exists", async () => {
      mockedStat.mockResolvedValue({ isFile: () => true } as any);
      mockedReadFile.mockResolvedValue(CARGO_TOML as any);

      const eco = new RustEcosystem(pkgPath);
      const descriptor = await eco.createDescriptor();

      expect(descriptor).toBeInstanceOf(RustEcosystemDescriptor);
      const rustDescriptor = descriptor as RustEcosystemDescriptor;
      expect(rustDescriptor.cratesName).toBe("my-crate");
      expect(rustDescriptor.path).toBe(pkgPath);
    });

    it("returns RustEcosystemDescriptor with undefined cratesName when Cargo.toml does not exist", async () => {
      mockedStat.mockRejectedValue(
        Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
      );

      const eco = new RustEcosystem(pkgPath);
      const descriptor = await eco.createDescriptor();

      expect(descriptor).toBeInstanceOf(RustEcosystemDescriptor);
      const rustDescriptor = descriptor as RustEcosystemDescriptor;
      expect(rustDescriptor.cratesName).toBeUndefined();
    });
  });
});
