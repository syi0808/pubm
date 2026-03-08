import path from "node:path";
import { exec, NonZeroExitError } from "tinyexec";
import { AbstractError } from "../error.js";
import { Registry, type RegistryRequirements } from "./registry.js";

class CratesError extends AbstractError {
  name = "crates.io Error";
}

const USER_AGENT = "pubm (https://github.com/syi0808/pubm)";

export class CratesRegistry extends Registry {
  registry = "https://crates.io";

  private get headers(): Record<string, string> {
    return { "User-Agent": USER_AGENT };
  }

  async ping(): Promise<boolean> {
    try {
      const response = await fetch(`${this.registry}/api/v1`, {
        headers: this.headers,
      });
      return response.ok;
    } catch (error) {
      throw new CratesError("Failed to ping crates.io", { cause: error });
    }
  }

  async isInstalled(): Promise<boolean> {
    try {
      await exec("cargo", ["--version"]);
      return true;
    } catch {
      return false;
    }
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

  async publish(manifestDir?: string): Promise<boolean> {
    try {
      const args = ["publish"];
      if (manifestDir) {
        args.push("--manifest-path", path.join(manifestDir, "Cargo.toml"));
      }
      await exec("cargo", args, { throwOnError: true });
      return true;
    } catch (error) {
      const stderr =
        error instanceof NonZeroExitError ? error.output?.stderr : undefined;
      const message = stderr
        ? `Failed to run \`cargo publish\`:\n${stderr}`
        : "Failed to run `cargo publish`";
      throw new CratesError(message, { cause: error });
    }
  }

  async dryRunPublish(manifestDir?: string): Promise<void> {
    try {
      const args = ["publish", "--dry-run"];
      if (manifestDir) {
        args.push("--manifest-path", path.join(manifestDir, "Cargo.toml"));
      }
      await exec("cargo", args, { throwOnError: true });
    } catch (error) {
      const stderr =
        error instanceof NonZeroExitError ? error.output?.stderr : undefined;
      const message = stderr
        ? `Failed to run \`cargo publish --dry-run\`:\n${stderr}`
        : "Failed to run `cargo publish --dry-run`";
      throw new CratesError(message, { cause: error });
    }
  }

  async isVersionPublished(version: string): Promise<boolean> {
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
    return this.isInstalled();
  }

  getRequirements(): RegistryRequirements {
    return {
      needsPackageScripts: false,
      requiredManifest: "Cargo.toml",
    };
  }

  async isPackageNameAvaliable(): Promise<boolean> {
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

export async function cratesRegistry(
  packageName: string,
): Promise<CratesRegistry> {
  return new CratesRegistry(packageName);
}
