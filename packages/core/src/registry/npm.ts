import { tmpdir } from "node:os";
import { join } from "node:path";
import { AbstractError } from "../error.js";
import { exec, NonZeroExitError } from "../utils/exec.js";
import { getPackageJson } from "../utils/package.js";
import { isValidPackageName } from "../utils/package-name.js";
import { Registry, type RegistryRequirements } from "./registry.js";

class NpmError extends AbstractError {
  name = "npm Error";
}

export class NpmRegistry extends Registry {
  constructor(packageName?: string, registry?: string) {
    super(packageName ?? "", registry ?? "https://registry.npmjs.org");
  }

  protected async npm(args: string[]): Promise<string> {
    const { stdout } = await exec("npm", args, { throwOnError: true });

    return stdout;
  }

  async isInstalled(): Promise<boolean> {
    try {
      await this.npm(["--version"]);

      return true;
    } catch {
      return false;
    }
  }

  async installGlobally(packageName: string): Promise<boolean> {
    try {
      await this.npm(["install", "-g", packageName]);

      return true;
    } catch (error) {
      throw new NpmError(`Failed to run \`npm install -g ${packageName}\``, {
        cause: error,
      });
    }
  }

  async isPublished(): Promise<boolean> {
    try {
      const response = await fetch(`${this.registry}/${this.packageName}`);

      return response.status === 200;
    } catch (error) {
      throw new NpmError(
        `Failed to fetch \`${this.registry}/${this.packageName}\``,
        { cause: error },
      );
    }
  }

  async isVersionPublished(version: string): Promise<boolean> {
    try {
      const response = await fetch(
        `${this.registry}/${this.packageName}/${version}`,
      );
      return response.status === 200;
    } catch (error) {
      throw new NpmError(
        `Failed to fetch \`${this.registry}/${this.packageName}/${version}\``,
        { cause: error },
      );
    }
  }

  async userName(): Promise<string> {
    try {
      return (await this.npm(["whoami"])).trim();
    } catch (error) {
      throw new NpmError("Failed to run `npm whoami`", { cause: error });
    }
  }

  async isLoggedIn(): Promise<boolean> {
    try {
      await this.npm(["whoami"]);

      return true;
    } catch (error) {
      if (error instanceof NonZeroExitError) {
        return false;
      }

      throw new NpmError("Failed to run `npm whoami`", { cause: error });
    }
  }

  async collaborators(): Promise<Record<string, string>> {
    try {
      const output = await this.npm([
        "access",
        "list",
        "collaborators",
        this.packageName,
        "--json",
      ]);
      try {
        return JSON.parse(output);
      } catch {
        throw new NpmError(
          `Unexpected response from npm registry for collaborators of '${this.packageName}'`,
        );
      }
    } catch (error) {
      if (error instanceof NpmError) throw error;
      throw new NpmError(
        `Failed to run \`npm access list collaborators ${this.packageName} --json\``,
        { cause: error },
      );
    }
  }

  async hasPermission(): Promise<boolean> {
    const userName = await this.userName();

    const collaborators = await this.collaborators();

    return !!collaborators[userName]?.includes("write");
  }

  async distTags(): Promise<string[]> {
    try {
      const output = await this.npm([
        "view",
        this.packageName,
        "dist-tags",
        "--json",
      ]);
      try {
        return Object.keys(JSON.parse(output));
      } catch {
        throw new NpmError(
          `Unexpected response from npm registry for dist-tags of '${this.packageName}'`,
        );
      }
    } catch (error) {
      if (error instanceof NpmError) throw error;
      throw new NpmError(
        `Failed to run \`npm view ${this.packageName} dist-tags --json\``,
        { cause: error },
      );
    }
  }

  async version(): Promise<string> {
    try {
      return this.npm(["--version"]);
      /* v8 ignore next 3 */
    } catch (error) {
      throw new NpmError("Failed to run `npm --version`", { cause: error });
    }
  }

  async ping(): Promise<boolean> {
    try {
      await exec("npm", ["ping"], { throwOnError: true });

      return true;
    } catch (error) {
      throw new NpmError("Failed to run `npm ping`", { cause: error });
    }
  }

  async publishProvenance(): Promise<boolean> {
    try {
      await this.npm(["publish", "--provenance", "--access", "public"]);

      return true;
    } catch (error) {
      if (
        error instanceof NonZeroExitError &&
        error.output?.stderr.includes("EOTP")
      ) {
        return false;
      }

      if (this.isProvenanceError(error)) {
        return this.publish();
      }

      throw this.classifyPublishError(error);
    }
  }

  async publish(otp?: string): Promise<boolean> {
    const args = otp ? ["publish", "--otp", otp] : ["publish"];

    try {
      await this.npm(args);

      return true;
    } catch (error) {
      if (
        error instanceof NonZeroExitError &&
        error.output?.stderr.includes("EOTP")
      ) {
        return false;
      }

      throw this.classifyPublishError(error);
    }
  }

  async dryRunPublish(): Promise<void> {
    try {
      await exec("npm", ["publish", "--dry-run"], {
        throwOnError: true,
        nodeOptions: {
          env: {
            ...process.env,
            npm_config_cache: join(tmpdir(), "pubm-npm-cache"),
          },
        },
      });
    } catch (error) {
      const stderr =
        error instanceof NonZeroExitError ? error.output.stderr : undefined;
      throw new NpmError(
        `Failed to run \`npm publish --dry-run\`${stderr ? `\n${stderr}` : ""}`,
        { cause: error },
      );
    }
  }

  async twoFactorAuthMode(): Promise<string | null> {
    try {
      const output = await this.npm(["profile", "get", "--json"]);
      const profile = JSON.parse(output);

      return profile?.tfa?.mode ?? null;
    } catch {
      return null;
    }
  }

  async isPackageNameAvaliable(): Promise<boolean> {
    return isValidPackageName(this.packageName);
  }

  getRequirements(): RegistryRequirements {
    return {
      needsPackageScripts: true,
      requiredManifest: "package.json",
    };
  }

  private isProvenanceError(error: unknown): boolean {
    if (!(error instanceof NonZeroExitError)) return false;
    const stderr = error.output.stderr;
    return (
      stderr.includes("verifying sigstore provenance") ||
      stderr.includes("provenance bundle")
    );
  }

  private classifyPublishError(error: unknown): NpmError {
    if (error instanceof NonZeroExitError) {
      const stderr = error.output.stderr;

      if (stderr.includes("EOTP")) {
        return new NpmError("OTP required for publishing", { cause: error });
      }
      if (stderr.includes("403") || stderr.includes("Forbidden")) {
        return new NpmError(
          `Permission denied (403 Forbidden). Check your npm access token permissions.${stderr ? `\n${stderr}` : ""}`,
          { cause: error },
        );
      }
      if (stderr.includes("429") || stderr.includes("Too Many Requests")) {
        return new NpmError(
          `Rate limited by npm registry. Please wait and try again.${stderr ? `\n${stderr}` : ""}`,
          { cause: error },
        );
      }

      return new NpmError(
        `Failed to publish to npm${stderr ? `\n${stderr}` : ""}`,
        { cause: error },
      );
    }

    return new NpmError("Failed to publish to npm", { cause: error });
  }
}

export async function npmRegistry(): Promise<NpmRegistry> {
  const packageJson = await getPackageJson();

  return new NpmRegistry(packageJson.name);
}
