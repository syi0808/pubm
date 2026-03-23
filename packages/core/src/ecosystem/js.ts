import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { JsrPackageRegistry } from "../registry/jsr.js";
import { NpmPackageRegistry } from "../registry/npm.js";
import type { PackageRegistry } from "../registry/package-registry.js";
import type { RegistryType } from "../types/options.js";
import {
  type PackageManager,
  getInstallCommand,
  getPackageManager,
  lockFiles,
} from "../utils/package-manager.js";
import { exec } from "../utils/exec.js";
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

  async syncLockfile(
    mode: "required" | "optional" | "skip" = "optional",
  ): Promise<string | undefined> {
    if (mode === "skip") return undefined;

    const found = await this.findLockfile();
    if (!found) return undefined;

    const { lockfilePath, packageManager } = found;
    const lockfileDir = path.dirname(lockfilePath);

    try {
      let isYarnBerry: boolean | undefined;
      if (packageManager === "yarn") {
        const yarnrcPath = path.join(lockfileDir, ".yarnrc.yml");
        try {
          isYarnBerry = (await stat(yarnrcPath)).isFile();
        } catch {
          isYarnBerry = false;
        }
      }

      const [cmd, ...args] = getInstallCommand(packageManager, isYarnBerry);
      await exec(cmd, args, { nodeOptions: { cwd: lockfileDir } });
      return lockfilePath;
    } catch (error) {
      if (mode === "required") throw error;
      console.warn(
        `Warning: Failed to sync lockfile at ${lockfilePath}: ${error instanceof Error ? error.message : error}`,
      );
      return undefined;
    }
  }

  /**
   * Walk from packagePath upward to find the first JS lock file.
   * In JS monorepos, the first lock file found ascending is the workspace root's.
   * Nested lock files below a workspace root indicate a separate project boundary,
   * not a workspace member.
   */
  private async findLockfile(): Promise<
    { lockfilePath: string; packageManager: PackageManager } | undefined
  > {
    let dir = this.packagePath;
    const { root } = path.parse(dir);

    while (dir !== root) {
      for (const [pm, files] of Object.entries(lockFiles)) {
        for (const file of files) {
          const candidate = path.join(dir, file);
          try {
            if ((await stat(candidate)).isFile()) {
              return {
                lockfilePath: candidate,
                packageManager: pm as PackageManager,
              };
            }
          } catch {}
        }
      }
      dir = path.dirname(dir);
    }

    return undefined;
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
