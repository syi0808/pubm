import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { color } from "listr2";
import type { PubmContext } from "../context.js";
import { AbstractError } from "../error.js";
import { ManifestReader } from "../manifest/manifest-reader.js";
import { exec, NonZeroExitError } from "../utils/exec.js";
import { isValidPackageName } from "../utils/package-name.js";
import { RegistryConnector } from "./connector.js";
import {
  PackageRegistry,
  type RegistryRequirements,
} from "./package-registry.js";

class NpmError extends AbstractError {
  name = "npm Error";
}

async function runNpm(args: string[]): Promise<string> {
  const { stdout } = await exec("npm", args, { throwOnError: true });
  return stdout;
}

export class NpmConnector extends RegistryConnector {
  constructor(registryUrl = "https://registry.npmjs.org") {
    super(registryUrl);
  }

  async ping(): Promise<boolean> {
    try {
      await exec("npm", ["ping"], { throwOnError: true });

      return true;
    } catch (error) {
      throw new NpmError("Failed to run `npm ping`", { cause: error });
    }
  }

  async isInstalled(): Promise<boolean> {
    try {
      await runNpm(["--version"]);

      return true;
    } catch {
      return false;
    }
  }

  async version(): Promise<string> {
    try {
      return runNpm(["--version"]);
      /* v8 ignore next 3 */
    } catch (error) {
      throw new NpmError("Failed to run `npm --version`", { cause: error });
    }
  }
}

export class NpmPackageRegistry extends PackageRegistry {
  static override reader = new ManifestReader({
    file: "package.json",
    parser: JSON.parse,
    fields: {
      name: (p) => (p.name as string) ?? "",
      version: (p) => (p.version as string) ?? "0.0.0",
      private: (p) => p.private === true,
      dependencies: (p) =>
        Object.keys({
          ...(p.dependencies as Record<string, string>),
          ...(p.devDependencies as Record<string, string>),
          ...(p.peerDependencies as Record<string, string>),
        }),
    },
  });
  static override registryType = "npm" as const;

  constructor(packageName?: string, registry?: string) {
    super(packageName ?? "", registry ?? "https://registry.npmjs.org");
  }

  protected async npm(args: string[]): Promise<string> {
    return runNpm(args);
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

  async isPackageNameAvailable(): Promise<boolean> {
    return isValidPackageName(this.packageName);
  }

  async checkAvailability(
    // biome-ignore lint/suspicious/noExplicitAny: listr2 TaskWrapper type is complex
    task: any,
    ctx: PubmContext,
  ): Promise<void> {
    // N1: Login check
    if (!(await this.isLoggedIn())) {
      if (ctx.runtime.promptEnabled) {
        try {
          task.output = "Launching npm login...";

          const { spawnInteractive } = await import(
            "../utils/spawn-interactive.js"
          );
          const child = spawnInteractive(["npm", "login"]);

          let opened = false;

          const readStream = async (
            stream: ReadableStream<Uint8Array>,
            onData: (text: string) => void,
          ) => {
            const reader = stream.getReader();
            const decoder = new TextDecoder();
            try {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                onData(decoder.decode(value));
              }
            } finally {
              reader.releaseLock();
            }
          };

          await new Promise<void>((resolve, reject) => {
            const onData = (text: string) => {
              const urlMatch = text.match(
                /https:\/\/www\.npmjs\.com\/login[^\s]*/,
              );

              if (urlMatch && !opened) {
                opened = true;
                task.output = `Login at: ${color.cyan(urlMatch[0])}`;
                import("../utils/open-url.js").then(({ openUrl }) =>
                  openUrl(urlMatch[0]),
                );
                child.stdin.write("\n");
                child.stdin.flush();
              }
            };

            Promise.all([
              readStream(child.stdout, onData),
              readStream(child.stderr, onData),
            ]).catch(reject);

            child.exited
              .then((code) =>
                code === 0
                  ? resolve()
                  : reject(new Error(`npm login exited with code ${code}`)),
              )
              .catch(reject);
          });
        } catch (error) {
          throw new NpmError(
            "npm login failed. Please run `npm login` manually and try again.",
            { cause: error },
          );
        }

        if (!(await this.isLoggedIn())) {
          throw new NpmError(
            "Still not logged in after npm login. Please verify your credentials.",
          );
        }
      } else {
        throw new NpmError("Not logged in to npm. Set NODE_AUTH_TOKEN.");
      }
    }

    // N2: Published + permission
    if (await this.isPublished()) {
      if (!(await this.hasPermission())) {
        throw new NpmError("No permission to publish on npm.");
      }
      return;
    }

    // N3: Package name availability
    if (!(await this.isPackageNameAvailable())) {
      throw new NpmError("Package name is not available.");
    }

    // N4: CI 2FA warning
    if (!ctx.runtime.promptEnabled) {
      const tfaMode = await this.twoFactorAuthMode();
      if (tfaMode === "auth-and-writes") {
        throw new NpmError("2FA auth-and-writes blocks CI publish.");
      }
    }
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

export function npmConnector(): NpmConnector {
  return new NpmConnector();
}

export async function npmPackageRegistry(
  packagePath: string,
): Promise<NpmPackageRegistry> {
  const manifest = await NpmPackageRegistry.reader.read(packagePath);
  return new NpmPackageRegistry(manifest.name);
}
