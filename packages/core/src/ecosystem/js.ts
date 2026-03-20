import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { JsrPackageRegistry } from "../registry/jsr.js";
import { NpmPackageRegistry } from "../registry/npm.js";
import type { PackageRegistry } from "../registry/package-registry.js";
import type { RegistryType } from "../types/options.js";
import { getPackageManager } from "../utils/package-manager.js";
import type { EcosystemDescriptor } from "./descriptor.js";
import { Ecosystem } from "./ecosystem.js";
import { JsEcosystemDescriptor } from "./js-descriptor.js";

const versionRegex = /("version"\s*:\s*")[^"]*(")/;

export class JsEcosystem extends Ecosystem {
  static async detect(packagePath: string): Promise<boolean> {
    return NpmPackageRegistry.reader.exists(packagePath);
  }

  registryClasses(): (typeof PackageRegistry)[] {
    return [
      NpmPackageRegistry,
      JsrPackageRegistry,
    ] as unknown as (typeof PackageRegistry)[];
  }

  async writeVersion(newVersion: string): Promise<void> {
    const files = ["package.json", "jsr.json"];

    for (const file of files) {
      const filePath = path.join(this.packagePath, file);
      try {
        const content = await readFile(filePath, "utf-8");
        await writeFile(
          filePath,
          content.replace(versionRegex, `$1${newVersion}$2`),
        );
      } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
  }

  manifestFiles(): string[] {
    return ["package.json"];
  }

  async defaultTestCommand(): Promise<string> {
    const pm = await getPackageManager();
    return `${pm} run test`;
  }

  async defaultBuildCommand(): Promise<string> {
    const pm = await getPackageManager();
    return `${pm} run build`;
  }

  supportedRegistries(): RegistryType[] {
    return ["npm", "jsr"];
  }

  async resolvePublishDependencies(
    workspaceVersions: Map<string, string>,
  ): Promise<Map<string, string>> {
    const backups = new Map<string, string>();
    const manifestPath = path.join(this.packagePath, "package.json");

    if (!existsSync(manifestPath)) return backups;

    const original = readFileSync(manifestPath, "utf-8");
    const pkg = JSON.parse(original);
    let modified = false;

    const WORKSPACE_PREFIX = "workspace:";
    const DEPENDENCY_FIELDS = [
      "dependencies",
      "devDependencies",
      "optionalDependencies",
      "peerDependencies",
    ] as const;

    for (const field of DEPENDENCY_FIELDS) {
      const deps = pkg[field] as Record<string, string> | undefined;
      if (!deps) continue;

      for (const [depName, spec] of Object.entries(deps)) {
        if (!spec.startsWith(WORKSPACE_PREFIX)) continue;

        const range = spec.slice(WORKSPACE_PREFIX.length);

        if (range === "*" || range === "^" || range === "~") {
          const version = workspaceVersions.get(depName);
          if (!version) {
            throw new Error(
              `Cannot resolve "${spec}" for dependency "${depName}": package not found in workspace`,
            );
          }
          // Inline workspace protocol resolution (same as resolveWorkspaceProtocol)
          deps[depName] =
            range === "*"
              ? version
              : range === "^"
                ? `^${version}`
                : `~${version}`;
        } else {
          deps[depName] = range;
        }

        modified = true;
      }
    }

    if (modified) {
      backups.set(manifestPath, original);
      writeFileSync(manifestPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf-8");
    }

    return backups;
  }

  async createDescriptor(): Promise<EcosystemDescriptor> {
    const npmReader = NpmPackageRegistry.reader;
    const jsrReader = JsrPackageRegistry.reader;

    const npmName = (await npmReader.exists(this.packagePath))
      ? (await npmReader.read(this.packagePath)).name
      : undefined;

    const jsrName = (await jsrReader.exists(this.packagePath))
      ? (await jsrReader.read(this.packagePath)).name
      : undefined;

    return new JsEcosystemDescriptor(this.packagePath, npmName, jsrName);
  }
}
