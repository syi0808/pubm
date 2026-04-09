import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { color } from "listr2";
import type { PubmContext } from "../context.js";
import { AbstractError } from "../error.js";
import { ManifestReader } from "../manifest/manifest-reader.js";
import type { RegistryType } from "../types/options.js";
import { exec, NonZeroExitError } from "../utils/exec.js";
import { normalizeRegistryUrl } from "../utils/normalize-registry-url.js";
import { isValidPackageName } from "../utils/package-name.js";
import { registerPrivateRegistry } from "./catalog.js";
import { RegistryConnector } from "./connector.js";
import {
  PackageRegistry,
  type RegistryRequirements,
} from "./package-registry.js";

class NpmError extends AbstractError {
  name = "npm Error";
}

function validateNpmLoginUrl(rawUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }

  if (parsed.origin !== "https://www.npmjs.com") {
    return null;
  }

  if (parsed.pathname.startsWith("/auth/cli/")) {
    const authPath = parsed.pathname.slice("/auth/cli/".length);
    return authPath ? rawUrl : null;
  }

  if (parsed.pathname !== "/login") {
    return null;
  }

  const next = parsed.searchParams.get("next");
  if (!next?.startsWith("/login/cli/")) {
    return null;
  }

  const authPath = next.slice("/login/cli/".length);
  return authPath ? rawUrl : null;
}

function extractNpmLoginUrl(text: string): string | null {
  const matches = text.match(/https:\/\/www\.npmjs\.com\/[^\s"'`<>]+/g);
  if (!matches) {
    return null;
  }

  for (const match of matches) {
    const validUrl = validateNpmLoginUrl(match);
    if (validUrl) {
      return validUrl;
    }
  }

  return null;
}

async function runNpm(args: string[], cwd?: string): Promise<string> {
  const { stdout } = await exec("npm", args, {
    throwOnError: true,
    nodeOptions: cwd ? { cwd } : undefined,
  });
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

  protected getVersionCommand(): [string, string[]] {
    return ["npm", ["--version"]];
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
    parser: (_filename: string, content: string) =>
      JSON.parse(content) as Record<string, unknown>,
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

  static override async canInfer(
    packagePath: string,
    rootPath?: string,
  ): Promise<RegistryType | false> {
    if (!(await NpmPackageRegistry.reader.exists(packagePath))) return false;

    const packageJsonPath = join(packagePath, "package.json");
    let packageJson: Record<string, unknown>;
    try {
      packageJson = JSON.parse(await readFile(packageJsonPath, "utf-8"));
    } catch {
      return false;
    }

    const packageName =
      typeof packageJson.name === "string" ? packageJson.name : undefined;
    const publishConfig = packageJson.publishConfig as
      | Record<string, unknown>
      | undefined;
    const publishConfigRegistry =
      typeof publishConfig?.registry === "string"
        ? publishConfig.registry
        : undefined;

    let npmRegistryUrl: string | null = null;

    if (publishConfigRegistry) {
      npmRegistryUrl = publishConfigRegistry;
    } else {
      npmRegistryUrl = await NpmPackageRegistry.readNpmrcRegistry(
        packagePath,
        packageName,
      );
      if (!npmRegistryUrl && rootPath && rootPath !== packagePath) {
        npmRegistryUrl = await NpmPackageRegistry.readNpmrcRegistry(
          rootPath,
          packageName,
        );
      }
    }

    const NPM_OFFICIAL = "registry.npmjs.org";
    if (
      npmRegistryUrl &&
      !normalizeRegistryUrl(npmRegistryUrl).includes(NPM_OFFICIAL)
    ) {
      const key = normalizeRegistryUrl(npmRegistryUrl);
      registerPrivateRegistry(
        {
          url: npmRegistryUrl,
          token: {
            envVar: `${key.replace(/[^a-zA-Z0-9]/g, "_").toUpperCase()}_TOKEN`,
          },
        },
        "js",
      );
      return key as RegistryType;
    }

    return "npm";
  }

  private static async readNpmrcRegistry(
    dir: string,
    packageName?: string,
  ): Promise<string | null> {
    try {
      const content = await readFile(join(dir, ".npmrc"), "utf-8");
      const lines = content.split("\n");

      if (packageName?.startsWith("@")) {
        const scope = packageName.split("/")[0];
        for (const line of lines) {
          const match = line.match(
            new RegExp(`^${scope.replace("/", "\\/")}:registry=(.+)$`),
          );
          if (match) return match[1].trim();
        }
      }

      for (const line of lines) {
        const match = line.match(/^registry=(.+)$/);
        if (match) return match[1].trim();
      }
    } catch {
      // .npmrc doesn't exist
    }
    return null;
  }

  constructor(packageName: string, packagePath: string, registry?: string) {
    super(packageName, packagePath, registry ?? "https://registry.npmjs.org");
  }

  protected async npm(args: string[], cwd?: string): Promise<string> {
    return runNpm(args, cwd);
  }

  protected override get registryErrorName(): string {
    return "npm Error";
  }

  protected override createRegistryError(
    message: string,
    options?: { cause?: unknown },
  ): AbstractError {
    return new NpmError(message, options);
  }

  protected override buildPackageUrl(): string {
    return `${this.registry}/${this.packageName}`;
  }

  protected override buildVersionUrl(version: string): string {
    return `${this.registry}/${this.packageName}/${version}`;
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
      await this.npm(args, this.packagePath);

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
      await this.npm(
        ["publish", "--provenance", "--access", "public"],
        this.packagePath,
      );

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

  override get supportsUnpublish(): boolean {
    return true;
  }

  async unpublish(packageName: string, version: string): Promise<void> {
    await this.npm(
      ["unpublish", `${packageName}@${version}`],
      this.packagePath,
    );
  }

  async dryRunPublish(): Promise<void> {
    try {
      await exec("npm", ["publish", "--dry-run"], {
        throwOnError: true,
        nodeOptions: {
          cwd: this.packagePath,
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
          let loginPromise = ctx.runtime.npmLoginPromise;

          if (!loginPromise) {
            loginPromise = this.runInteractiveLogin(task).finally(() => {
              if (ctx.runtime.npmLoginPromise === loginPromise) {
                ctx.runtime.npmLoginPromise = undefined;
              }
            });
            ctx.runtime.npmLoginPromise = loginPromise;
          } else {
            task.output = "Waiting for npm login...";
          }

          await loginPromise;
        } catch (error) {
          const detail = error instanceof Error ? `: ${error.message}` : "";
          throw new NpmError(
            `npm login failed${detail}. Please run \`npm login\` manually and try again.`,
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

  private async runInteractiveLogin(
    // biome-ignore lint/suspicious/noExplicitAny: listr2 TaskWrapper type is complex
    task: any,
  ): Promise<void> {
    task.output = "Launching npm login...";

    const [{ spawnInteractive }, { openUrl }] = await Promise.all([
      import("../utils/spawn-interactive.js"),
      import("../utils/open-url.js"),
    ]);
    const child = spawnInteractive(["npm", "login"]);

    let openedUrl: string | null = null;
    let bufferedText = "";

    const onData = (text: string) => {
      bufferedText = `${bufferedText}${text}`.slice(-4096);

      const canonicalUrl = extractNpmLoginUrl(bufferedText);
      if (!canonicalUrl || openedUrl) {
        return;
      }

      openedUrl = canonicalUrl;
      task.output = `Login at: ${color.cyan(canonicalUrl)}`;
      void openUrl(canonicalUrl);
    };

    await Promise.all([
      this.readInteractiveStream(child.stdout, onData),
      this.readInteractiveStream(child.stderr, onData),
      child.exited.then((code) => {
        if (code !== 0) {
          throw new Error(`npm login exited with code ${code}`);
        }
      }),
    ]);

    if (!openedUrl) {
      throw new Error("npm login did not provide a supported web login URL.");
    }
  }

  private async readInteractiveStream(
    stream: ReadableStream<Uint8Array>,
    onData: (text: string) => void,
  ): Promise<void> {
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
  }
}

export function npmConnector(): NpmConnector {
  return new NpmConnector();
}

export async function npmPackageRegistry(
  packagePath: string,
): Promise<NpmPackageRegistry> {
  const manifest = await NpmPackageRegistry.reader.read(packagePath);
  return new NpmPackageRegistry(manifest.name, packagePath);
}
