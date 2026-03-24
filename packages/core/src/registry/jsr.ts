import process from "node:process";
import { ListrEnquirerPromptAdapter } from "@listr2/prompt-adapter-enquirer";
import type { PubmContext } from "../context.js";
import { AbstractError } from "../error.js";
import { ManifestReader } from "../manifest/manifest-reader.js";
import type { JsrApi } from "../types/jsr-api.js";
import { exec, NonZeroExitError } from "../utils/exec.js";
import {
  getScope,
  getScopeAndName,
  isScopedPackage,
  isValidPackageName,
} from "../utils/package-name.js";
import { PUBM_VERSION } from "../utils/pubm-metadata.js";
import { SecureStore } from "../utils/secure-store.js";
import { ui } from "../utils/ui.js";
import { RegistryConnector } from "./connector.js";
import {
  PackageRegistry,
  type RegistryRequirements,
} from "./package-registry.js";

class JsrError extends AbstractError {
  name = "jsr Error";
}

function getApiEndpoint(registry: string): string {
  const url = new URL(registry);

  url.host = `api.${url.host}`;

  return url.href.replace(/\/$/, "");
}

async function runJsr(args: string[]): Promise<string> {
  const { stdout } = await exec("jsr", args, { throwOnError: true });
  return stdout;
}

export class JsrConnector extends RegistryConnector {
  constructor(registryUrl = "https://jsr.io") {
    super(registryUrl);
  }

  async ping(): Promise<boolean> {
    try {
      const flag = process.platform === "win32" ? "-n" : "-c";
      const { stdout } = await exec(
        "ping",
        [flag, "1", new URL(this.registryUrl).hostname],
        { throwOnError: true },
      );

      return (
        stdout.includes("1 packets transmitted") || stdout.includes("Sent = 1")
      );
    } catch (error) {
      throw new JsrError(
        `Failed to ping ${new URL(this.registryUrl).hostname}`,
        {
          cause: error,
        },
      );
    }
  }

  async isInstalled(): Promise<boolean> {
    try {
      await runJsr(["--version"]);

      return true;
    } catch {
      return false;
    }
  }

  async version(): Promise<string> {
    return await runJsr(["--version"]);
  }
}

export class JsrPackageRegistry extends PackageRegistry {
  static override reader = new ManifestReader({
    file: "jsr.json",
    parser: JSON.parse,
    fields: {
      name: (p) => (p.name as string) ?? "",
      version: (p) => (p.version as string) ?? "0.0.0",
      private: (_p) => false,
      dependencies: (_p) => [],
    },
  });
  static override registryType = "jsr" as const;

  registry = "https://jsr.io";
  client: JsrClient;
  packageCreationUrls?: string[];

  constructor(packageName: string, packagePath: string, registry?: string) {
    super(packageName, packagePath, registry);

    this.client = new JsrClient(getApiEndpoint(this.registry));
  }

  protected async jsr(args: string[]): Promise<string> {
    return runJsr(args);
  }

  async distTags(): Promise<string[]> {
    return [];
  }

  async publish(): Promise<boolean> {
    try {
      await exec(
        "jsr",
        [
          "publish",
          "--allow-dirty",
          "--allow-slow-types",
          "--token",
          `${JsrClient.token}`,
        ],
        {
          throwOnError: true,
          nodeOptions: { cwd: this.packagePath },
        },
      );

      this.packageCreationUrls = undefined;
      return true;
    } catch (error) {
      const stderr =
        error instanceof NonZeroExitError ? error.output?.stderr : undefined;

      if (stderr?.includes("don't exist")) {
        const urls = [...stderr.matchAll(/https:\/\/jsr\.io\/new\S+/g)].map(
          (m) => m[0],
        );

        if (urls.length > 0) {
          this.packageCreationUrls = urls;
          return false;
        }
      }

      throw new JsrError(
        `Failed to run \`jsr publish --allow-dirty --token ***\`${stderr ? `\n${stderr}` : ""}`,
        {
          cause: error,
        },
      );
    }
  }

  async dryRunPublish(): Promise<void> {
    try {
      await exec(
        "jsr",
        [
          "publish",
          "--dry-run",
          "--allow-dirty",
          "--allow-slow-types",
          "--token",
          `${JsrClient.token}`,
        ],
        {
          throwOnError: true,
          nodeOptions: { cwd: this.packagePath },
        },
      );
    } catch (error) {
      const stderr =
        error instanceof NonZeroExitError ? error.output?.stderr : undefined;

      throw new JsrError(
        `Failed to run \`jsr publish --dry-run\`${stderr ? `\n${stderr}` : ""}`,
        {
          cause: error,
        },
      );
    }
  }

  async isPublished(): Promise<boolean> {
    try {
      const response = await fetch(`${this.registry}/${this.packageName}`);

      return response.status === 200;
    } catch (error) {
      throw new JsrError(
        `Failed to fetch \`${this.registry}/${this.packageName}\``,
        { cause: error },
      );
    }
  }

  async isVersionPublished(version: string): Promise<boolean> {
    if (!version) return false;
    try {
      const [scope, name] = getScopeAndName(this.packageName);
      const response = await fetch(
        `${this.registry}/@${scope}/${name}/${version}`,
      );
      return response.status === 200;
    } catch (error) {
      throw new JsrError(
        `Failed to fetch \`${this.registry}/${this.packageName}/${version}\``,
        { cause: error },
      );
    }
  }

  async hasPermission(): Promise<boolean> {
    return (
      (await this.client.scopePermission(`${getScope(this.packageName)}`)) !==
      null
    );
  }

  async isPackageNameAvailable(): Promise<boolean> {
    return isValidPackageName(this.packageName);
  }

  getRequirements(): RegistryRequirements {
    return {
      needsPackageScripts: false,
      requiredManifest: "jsr.json",
    };
  }

  async checkAvailability(
    // biome-ignore lint/suspicious/noExplicitAny: listr2 TaskWrapper type is complex
    task: any,
    ctx: PubmContext,
  ): Promise<void> {
    // Existing: jsr CLI install prompt
    const connector = new JsrConnector();
    if (!(await connector.isInstalled())) {
      const install = await task.prompt(ListrEnquirerPromptAdapter).run({
        type: "toggle",
        message: `${ui.labels.WARNING} jsr is not installed. Do you want to install jsr?`,
        enabled: "Yes",
        disabled: "No",
      });

      if (install) {
        task.output = "Installing jsr...";
        const { npmInstallGlobally } = await import("../utils/npm-install.js");
        await npmInstallGlobally("jsr");
      } else {
        throw new Error("jsr is not installed. Please install jsr to proceed.");
      }
    }

    // J1, J2, J3: Non-scoped package → scope selection + creation + rollback
    if (!isScopedPackage(this.packageName)) {
      // J3: Register rollback
      ctx.runtime.rollback.add({
        label: `Delete JSR package ${this.packageName}`,
        fn: async (rollbackCtx) => {
          if (rollbackCtx.runtime.packageCreated) {
            await this.client.deletePackage(this.packageName);
          }
          if (rollbackCtx.runtime.scopeCreated) {
            await this.client.deleteScope(`${getScope(this.packageName)}`);
          }
        },
      });

      // J1: Scope selection prompt (interactive only)
      if (ctx.runtime.promptEnabled) {
        const scopes = await this.client.scopes();
        const { Git } = await import("../git.js");
        const userName = await new Git().userName();

        const selectedName: string = await task
          .prompt(ListrEnquirerPromptAdapter)
          .run({
            type: "select",
            message:
              "Package name is not scoped. Please select a scope for jsr",
            choices: [
              {
                message: `@${this.packageName}/${this.packageName} (scoped by package name)`,
                name: `@${this.packageName}/${this.packageName}`,
              },
              {
                message: `@${userName}/${this.packageName} (scoped by git name)`,
                name: `@${userName}/${this.packageName}`,
              },
              ...scopes.flatMap((scope) =>
                scope === this.packageName || scope === userName
                  ? []
                  : [
                      {
                        message: `@${scope}/${this.packageName} (scope from jsr)`,
                        name: `@${scope}/${this.packageName}`,
                      },
                    ],
              ),
            ],
          });

        this.packageName = selectedName;

        // J2: Auto-create scope/package
        const scope = getScope(this.packageName);
        if (scope && !scopes.includes(scope)) {
          task.output = "Creating scope for jsr...";
          await this.client.createScope(scope);
          ctx.runtime.scopeCreated = true;
        }

        if (
          ctx.runtime.scopeCreated ||
          !(await this.client.package(this.packageName))
        ) {
          task.output = "Creating package for jsr...";
          await this.client.createPackage(this.packageName);
          ctx.runtime.packageCreated = true;
        }
      }
    }

    // J4: Scope permission check
    const hasPermission = await this.hasPermission();
    if (isScopedPackage(this.packageName) && !hasPermission) {
      throw new JsrError("No permission to publish scope.");
    }

    // J5: Published + permission
    if (await this.isPublished()) {
      if (!hasPermission) {
        throw new JsrError("No permission to publish on jsr.");
      }
      return;
    }

    // J6: Package name availability
    if (!(await this.isPackageNameAvailable())) {
      throw new JsrError("Package name is not available on jsr.");
    }
  }
}

export class JsrClient {
  static #cachedToken: string | null | undefined = undefined;

  static get token(): string | null {
    if (JsrClient.#cachedToken === undefined) {
      JsrClient.#cachedToken = new SecureStore().get("jsr-token");
    }
    return JsrClient.#cachedToken;
  }

  static set token(value: string | null) {
    JsrClient.#cachedToken = value;
  }

  constructor(public apiEndpoint: string) {}

  protected async fetch(
    endpoint: string,
    init?: RequestInit,
  ): Promise<Response> {
    return fetch(new URL(endpoint, this.apiEndpoint), {
      ...init,
      headers: {
        ...init?.headers,
        Authorization: `Bearer ${JsrClient.token}`,
        "User-Agent": `pubm/${PUBM_VERSION}; https://github.com/syi0808/pubm`,
      },
    });
  }

  async user(): Promise<JsrApi.Users.User | null> {
    try {
      const response = await this.fetch("/user");

      if (response.status === 401) return null;

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      throw new JsrError(`Failed to fetch \`${this.apiEndpoint}/user\``, {
        cause: error,
      });
    }
  }

  async scopePermission(
    scope: string,
  ): Promise<JsrApi.Users.Scopes.Permission | null> {
    try {
      const response = await this.fetch(`/user/member/${scope}`);

      if (response.status === 401) return null;

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      throw new JsrError(
        `Failed to fetch \`${this.apiEndpoint}/user/member/${scope}\``,
        {
          cause: error,
        },
      );
    }
  }

  async scopes(): Promise<string[]> {
    try {
      const response = await this.fetch("/user/scopes");

      if (response.status === 401) return [];

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const body = await response.json();

      if (!Array.isArray(body)) {
        throw new Error(`Expected array response but got ${typeof body}`);
      }

      return (body as JsrApi.Users.Scopes).map(({ scope }) => scope);
    } catch (error) {
      throw new JsrError(
        `Failed to fetch \`${this.apiEndpoint}/user/scopes\``,
        {
          cause: error,
        },
      );
    }
  }

  async package(
    packageName: string,
  ): Promise<JsrApi.Scopes.Packages.Package | null> {
    const [scope, name] = getScopeAndName(packageName);

    try {
      const response = await this.fetch(`/scopes/${scope}/packages/${name}`);

      if (response.status === 404) return null;

      if (!response.ok) {
        throw new JsrError(
          `JSR API error (HTTP ${response.status}) for package '${packageName}'`,
        );
      }

      return await response.json();
    } catch (error) {
      if (error instanceof JsrError) throw error;
      throw new JsrError(
        `Failed to fetch \`${this.apiEndpoint}/scopes/${scope}/packages/${name}\``,
        {
          cause: error,
        },
      );
    }
  }

  async createScope(scope: string): Promise<boolean> {
    try {
      const response = await this.fetch("/scopes", {
        method: "POST",
        body: JSON.stringify({ scope }),
      });

      if (response.status === 200 || response.status === 201) return true;

      let detail = "";
      try {
        const body = await response.json();
        detail = body.message || body.error || JSON.stringify(body);
      } catch {}

      throw new JsrError(
        `Failed to create scope '${scope}': HTTP ${response.status}${detail ? ` — ${detail}` : ""}`,
      );
    } catch (error) {
      if (error instanceof JsrError) throw error;
      throw new JsrError(`Failed to fetch \`${this.apiEndpoint}/scopes\``, {
        cause: error,
      });
    }
  }

  async deleteScope(scope: string): Promise<boolean> {
    try {
      const response = await this.fetch(`/scopes/${scope}`, {
        method: "DELETE",
      });

      if (response.status === 200 || response.status === 204) return true;

      let detail = "";
      try {
        const body = await response.json();
        detail = body.message || body.error || JSON.stringify(body);
      } catch {}

      throw new JsrError(
        `Failed to delete scope '${scope}': HTTP ${response.status}${detail ? ` — ${detail}` : ""}`,
      );
    } catch (error) {
      if (error instanceof JsrError) throw error;
      throw new JsrError(
        `Failed to fetch \`${this.apiEndpoint}/scopes/${scope}\``,
        {
          cause: error,
        },
      );
    }
  }

  async createPackage(packageName: string): Promise<boolean> {
    const [scope, name] = getScopeAndName(packageName);

    try {
      const response = await this.fetch(`/scopes/${scope}/packages`, {
        method: "POST",
        body: JSON.stringify({ package: name }),
      });

      if (response.status === 200 || response.status === 201) return true;

      let detail = "";
      try {
        const body = await response.json();
        detail = body.message || body.error || JSON.stringify(body);
      } catch {}

      throw new JsrError(
        `Failed to create package '${packageName}': HTTP ${response.status}${detail ? ` — ${detail}` : ""}`,
      );
    } catch (error) {
      if (error instanceof JsrError) throw error;
      throw new JsrError(
        `Failed to fetch \`${this.apiEndpoint}/scopes/${scope}/packages\``,
        {
          cause: error,
        },
      );
    }
  }

  async deletePackage(packageName: string): Promise<boolean> {
    const [scope, name] = getScopeAndName(packageName);

    try {
      const response = await this.fetch(`/scopes/${scope}/packages/${name}`, {
        method: "DELETE",
      });

      if (response.status === 200 || response.status === 204) return true;

      let detail = "";
      try {
        const body = await response.json();
        detail = body.message || body.error || JSON.stringify(body);
      } catch {}

      throw new JsrError(
        `Failed to delete package '${packageName}': HTTP ${response.status}${detail ? ` — ${detail}` : ""}`,
      );
    } catch (error) {
      if (error instanceof JsrError) throw error;
      throw new JsrError(
        `Failed to fetch \`${this.apiEndpoint}/scopes/${scope}/packages/${name}\``,
        {
          cause: error,
        },
      );
    }
  }

  async searchPackage(query: string): Promise<JsrApi.Packages> {
    try {
      const response = await this.fetch(`/packages?query=${query}`);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      throw new JsrError(
        `Failed to fetch \`${this.apiEndpoint}/packages?query=${query}\``,
        {
          cause: error,
        },
      );
    }
  }
}

export function jsrConnector(): JsrConnector {
  return new JsrConnector();
}

export async function jsrPackageRegistry(
  packagePath: string,
): Promise<JsrPackageRegistry> {
  const manifest = await JsrPackageRegistry.reader.read(packagePath);
  return new JsrPackageRegistry(manifest.name, packagePath);
}
