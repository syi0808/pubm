import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JsEcosystem } from "../../../src/ecosystem/js.js";
import { RustEcosystem } from "../../../src/ecosystem/rust.js";
import { CratesRegistry } from "../../../src/registry/crates.js";
import { JsrRegisry } from "../../../src/registry/jsr.js";
import { NpmRegistry } from "../../../src/registry/npm.js";

describe("Ecosystem manifest delegation", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "pubm-eco-test-"));
  });

  afterEach(async () => {
    NpmRegistry.reader.clearCache();
    JsrRegisry.reader.clearCache();
    CratesRegistry.reader.clearCache();
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe("JsEcosystem", () => {
    it("reads from package.json via registry reader", async () => {
      await writeFile(
        join(tmpDir, "package.json"),
        JSON.stringify({ name: "my-pkg", version: "1.2.3" }),
      );

      const eco = new JsEcosystem(tmpDir);
      const manifest = await eco.readManifest();

      expect(manifest.name).toBe("my-pkg");
      expect(manifest.version).toBe("1.2.3");
    });

    it("falls back to jsr.json when package.json is missing", async () => {
      await writeFile(
        join(tmpDir, "jsr.json"),
        JSON.stringify({ name: "@scope/jsr-only", version: "0.5.0" }),
      );

      const eco = new JsEcosystem(tmpDir);
      const manifest = await eco.readManifest();

      expect(manifest.name).toBe("@scope/jsr-only");
      expect(manifest.version).toBe("0.5.0");
    });

    it("detects registry version mismatch via readRegistryVersions", async () => {
      await writeFile(
        join(tmpDir, "package.json"),
        JSON.stringify({ name: "my-pkg", version: "1.0.0" }),
      );
      await writeFile(
        join(tmpDir, "jsr.json"),
        JSON.stringify({ name: "my-pkg", version: "1.1.0" }),
      );

      const eco = new JsEcosystem(tmpDir);
      const versions = await eco.readRegistryVersions();

      expect(versions.get("npm")).toBe("1.0.0");
      expect(versions.get("jsr")).toBe("1.1.0");
      expect(versions.size).toBe(2);
    });

    it("delegates packageName()", async () => {
      await writeFile(
        join(tmpDir, "package.json"),
        JSON.stringify({ name: "delegated-name", version: "1.0.0" }),
      );

      const eco = new JsEcosystem(tmpDir);
      expect(await eco.packageName()).toBe("delegated-name");
    });

    it("delegates readVersion()", async () => {
      await writeFile(
        join(tmpDir, "package.json"),
        JSON.stringify({ name: "pkg", version: "3.2.1" }),
      );

      const eco = new JsEcosystem(tmpDir);
      expect(await eco.readVersion()).toBe("3.2.1");
    });

    it("delegates isPrivate()", async () => {
      await writeFile(
        join(tmpDir, "package.json"),
        JSON.stringify({ name: "priv", version: "1.0.0", private: true }),
      );

      const eco = new JsEcosystem(tmpDir);
      expect(await eco.isPrivate()).toBe(true);
    });

    it("returns registryClasses with 2 entries", () => {
      const eco = new JsEcosystem(tmpDir);
      const classes = eco.registryClasses();
      expect(classes).toHaveLength(2);
    });
  });

  describe("RustEcosystem", () => {
    it("reads from Cargo.toml via registry reader", async () => {
      await writeFile(
        join(tmpDir, "Cargo.toml"),
        `[package]\nname = "my-crate"\nversion = "0.2.0"\n`,
      );

      const eco = new RustEcosystem(tmpDir);
      const manifest = await eco.readManifest();

      expect(manifest.name).toBe("my-crate");
      expect(manifest.version).toBe("0.2.0");
    });

    it("delegates dependencies()", async () => {
      await writeFile(
        join(tmpDir, "Cargo.toml"),
        `[package]\nname = "my-crate"\nversion = "0.1.0"\n\n[dependencies]\nserde = "1.0"\ntokio = "1.0"\n`,
      );

      const eco = new RustEcosystem(tmpDir);
      const deps = await eco.dependencies();

      expect(deps).toContain("serde");
      expect(deps).toContain("tokio");
    });
  });

  describe("error handling", () => {
    it("throws when no manifest exists", async () => {
      const eco = new JsEcosystem(tmpDir);
      await expect(eco.readManifest()).rejects.toThrow(
        "No manifest file found",
      );
    });
  });
});
