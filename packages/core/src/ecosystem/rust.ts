import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse, stringify } from "smol-toml";
import type { RegistryType } from "../types/options.js";
import { exec } from "../utils/exec.js";
import { Ecosystem } from "./ecosystem.js";

export class RustEcosystem extends Ecosystem {
  static async detect(packagePath: string): Promise<boolean> {
    try {
      return (await stat(path.join(packagePath, "Cargo.toml"))).isFile();
    } catch {
      return false;
    }
  }

  private async readCargoToml(): Promise<Record<string, unknown>> {
    const raw = await readFile(
      path.join(this.packagePath, "Cargo.toml"),
      "utf-8",
    );
    return parse(raw);
  }

  async packageName(): Promise<string> {
    const cargo = await this.readCargoToml();
    const pkg = cargo.package as Record<string, unknown>;
    return pkg.name as string;
  }

  async readVersion(): Promise<string> {
    const cargo = await this.readCargoToml();
    const pkg = cargo.package as Record<string, unknown>;
    return pkg.version as string;
  }

  async writeVersion(newVersion: string): Promise<void> {
    const filePath = path.join(this.packagePath, "Cargo.toml");
    const raw = await readFile(filePath, "utf-8");
    const cargo = parse(raw);

    const pkg = cargo.package as Record<string, unknown>;
    pkg.version = newVersion;

    await writeFile(filePath, stringify(cargo));
  }

  /**
   * Update the `version` field of dependencies that match sibling crate names.
   * This ensures `cargo publish` works when crates depend on each other via path.
   */
  async updateSiblingDependencyVersions(
    siblingVersions: Map<string, string>,
  ): Promise<boolean> {
    const filePath = path.join(this.packagePath, "Cargo.toml");
    const raw = await readFile(filePath, "utf-8");
    const cargo = parse(raw);

    let modified = false;

    for (const section of ["dependencies", "build-dependencies"]) {
      const sectionData = cargo[section] as Record<string, unknown> | undefined;
      if (!sectionData) continue;

      for (const [depName, depValue] of Object.entries(sectionData)) {
        if (
          typeof depValue === "object" &&
          depValue !== null &&
          "path" in depValue &&
          siblingVersions.has(depName)
        ) {
          const dep = depValue as Record<string, unknown>;
          dep.version = siblingVersions.get(depName) as string;
          modified = true;
        }
      }
    }

    if (modified) {
      await writeFile(filePath, stringify(cargo));
    }

    return modified;
  }

  async syncLockfile(): Promise<string | undefined> {
    const lockfilePath = await this.findLockfile();
    if (!lockfilePath) return undefined;

    const name = await this.packageName();
    await exec("cargo", ["update", "--package", name], {
      nodeOptions: { cwd: path.dirname(lockfilePath) },
    });

    return lockfilePath;
  }

  private async findLockfile(): Promise<string | undefined> {
    let dir = this.packagePath;
    const { root } = path.parse(dir);

    while (dir !== root) {
      const candidate = path.join(dir, "Cargo.lock");
      try {
        if ((await stat(candidate)).isFile()) return candidate;
      } catch {}
      dir = path.dirname(dir);
    }

    return undefined;
  }

  async dependencies(): Promise<string[]> {
    const cargo = await this.readCargoToml();
    const deps: string[] = [];

    for (const section of ["dependencies", "build-dependencies"]) {
      const sectionData = cargo[section] as Record<string, unknown> | undefined;
      if (sectionData) {
        deps.push(...Object.keys(sectionData));
      }
    }

    return deps;
  }

  manifestFiles(): string[] {
    return ["Cargo.toml"];
  }

  defaultTestCommand(): string {
    return "cargo test";
  }

  defaultBuildCommand(): string {
    return "cargo build --release";
  }

  supportedRegistries(): RegistryType[] {
    return ["crates"];
  }
}
