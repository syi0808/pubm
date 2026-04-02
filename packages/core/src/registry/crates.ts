import path from "node:path";
import process from "node:process";
import { parse } from "smol-toml";
import { AbstractError } from "../error.js";
import { ManifestReader } from "../manifest/manifest-reader.js";
import { exec, NonZeroExitError } from "../utils/exec.js";
import { RegistryConnector } from "./connector.js";
import {
  PackageRegistry,
  type RegistryRequirements,
} from "./package-registry.js";

class CratesError extends AbstractError {
  name = "crates.io Error";
}

const USER_AGENT = "pubm (https://github.com/syi0808/pubm)";

function cleanCargoStderr(stderr: string): string {
  return stderr
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      if (trimmed === "Updating crates.io index") return false;
      if (trimmed === "") return false;
      return true;
    })
    .join("\n");
}

export class CratesConnector extends RegistryConnector {
  constructor(registryUrl = "https://crates.io") {
    super(registryUrl);
  }

  private get headers(): Record<string, string> {
    return { "User-Agent": USER_AGENT };
  }

  async ping(): Promise<boolean> {
    try {
      const response = await fetch(`${this.registryUrl}/api/v1`, {
        headers: this.headers,
      });
      return response.ok;
    } catch (error) {
      throw new CratesError("Failed to ping crates.io", { cause: error });
    }
  }

  protected getVersionCommand(): [string, string[]] {
    return ["cargo", ["--version"]];
  }

  async version(): Promise<string> {
    try {
      const { stdout } = await exec("cargo", ["--version"]);
      return stdout.trim();
    } catch (error) {
      throw new CratesError("Failed to run `cargo --version`", {
        cause: error,
      });
    }
  }
}

export class CratesPackageRegistry extends PackageRegistry {
  static override reader = new ManifestReader({
    file: "Cargo.toml",
    parser: (_filename: string, raw: string) =>
      parse(raw) as Record<string, unknown>,
    fields: {
      name: (p) =>
        ((p.package as Record<string, unknown>)?.name as string) ?? "",
      version: (p) =>
        ((p.package as Record<string, unknown>)?.version as string) ?? "0.0.0",
      private: (p) => {
        const pkg = p.package as Record<string, unknown> | undefined;
        if (pkg?.publish === false) return true;
        if (
          Array.isArray(pkg?.publish) &&
          (pkg.publish as unknown[]).length === 0
        )
          return true;
        return false;
      },
      dependencies: (p) => [
        ...Object.keys((p.dependencies as Record<string, unknown>) ?? {}),
        ...Object.keys(
          (p["build-dependencies"] as Record<string, unknown>) ?? {},
        ),
      ],
    },
  });
  static override registryType = "crates" as const;

  constructor(
    packageName: string,
    packagePath: string,
    registry = "https://crates.io",
  ) {
    super(packageName, packagePath, registry);
  }

  private get headers(): Record<string, string> {
    return { "User-Agent": USER_AGENT };
  }

  async distTags(): Promise<string[]> {
    return [];
  }

  async version(): Promise<string> {
    try {
      const response = await fetch(
        `${this.registry}/api/v1/crates/${this.packageName}`,
        { headers: this.headers },
      );

      if (!response.ok) {
        if (response.status === 404) {
          throw new CratesError(
            `Crate '${this.packageName}' not found on crates.io`,
          );
        }
        throw new CratesError(
          `crates.io API error (HTTP ${response.status}) for crate '${this.packageName}'`,
        );
      }

      const data = (await response.json()) as {
        crate: { max_version: string };
      };
      return data.crate.max_version;
    } catch (error) {
      if (error instanceof CratesError) throw error;
      throw new CratesError(
        `Cannot reach crates.io to fetch version for '${this.packageName}'`,
        { cause: error },
      );
    }
  }

  async publish(): Promise<boolean> {
    try {
      const args = ["publish"];
      if (this.packagePath) {
        args.push("--manifest-path", path.join(this.packagePath, "Cargo.toml"));
      }
      await exec("cargo", args, { throwOnError: true });
      return true;
    } catch (error) {
      const stderr =
        error instanceof NonZeroExitError ? error.output?.stderr : undefined;
      const message = stderr
        ? `Failed to run \`cargo publish\`:\n${cleanCargoStderr(stderr)}`
        : "Failed to run `cargo publish`";
      throw new CratesError(message, { cause: error });
    }
  }

  override get supportsUnpublish(): boolean {
    return true;
  }

  async unpublish(_packageName: string, version: string): Promise<void> {
    const args = ["yank", "--vers", version];
    if (this.packagePath) {
      args.push("--manifest-path", path.join(this.packagePath, "Cargo.toml"));
    }
    await exec("cargo", args, { throwOnError: true });
  }

  async dryRunPublish(): Promise<void> {
    try {
      const args = ["publish", "--dry-run"];
      if (this.packagePath) {
        args.push("--manifest-path", path.join(this.packagePath, "Cargo.toml"));
      }
      await exec("cargo", args, { throwOnError: true });
    } catch (error) {
      const stderr =
        error instanceof NonZeroExitError ? error.output?.stderr : undefined;
      const message = stderr
        ? `Failed to run \`cargo publish --dry-run\`:\n${cleanCargoStderr(stderr)}`
        : "Failed to run `cargo publish --dry-run`";
      throw new CratesError(message, { cause: error });
    }
  }

  async isVersionPublished(version: string): Promise<boolean> {
    if (!version) return false;
    try {
      const response = await fetch(
        `${this.registry}/api/v1/crates/${this.packageName}/${version}`,
        { headers: this.headers },
      );
      return response.ok;
    } catch (error) {
      throw new CratesError(
        `Failed to check version ${version} for '${this.packageName}' on crates.io`,
        { cause: error },
      );
    }
  }

  async isPublished(): Promise<boolean> {
    try {
      const response = await fetch(
        `${this.registry}/api/v1/crates/${this.packageName}`,
        { headers: this.headers },
      );
      return response.ok;
    } catch {
      return false;
    }
  }

  async hasPermission(): Promise<boolean> {
    if (process.env.CARGO_REGISTRY_TOKEN) return true;
    const connector = new CratesConnector(this.registry);
    return connector.isInstalled();
  }

  getRequirements(): RegistryRequirements {
    return {
      needsPackageScripts: false,
      requiredManifest: "Cargo.toml",
    };
  }

  async isPackageNameAvailable(): Promise<boolean> {
    try {
      const response = await fetch(
        `${this.registry}/api/v1/crates/${this.packageName}`,
        { headers: this.headers },
      );
      return !response.ok;
    } catch (error) {
      throw new CratesError(
        `Failed to check package name availability on crates.io`,
        { cause: error },
      );
    }
  }
}

export function cratesConnector(): CratesConnector {
  return new CratesConnector();
}

export async function cratesPackageRegistry(
  packagePath: string,
): Promise<CratesPackageRegistry> {
  const manifest = await CratesPackageRegistry.reader.read(packagePath);
  return new CratesPackageRegistry(manifest.name, packagePath);
}
