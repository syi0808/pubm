import { exec, NonZeroExitError } from "tinyexec";
import { AbstractError } from "../error.js";
import type { JsrApi } from "../types/jsr-api.js";
import { Db } from "../utils/db.js";
import { getJsrJson, version } from "../utils/package.js";
import {
  getScope,
  getScopeAndName,
  isValidPackageName,
} from "../utils/package-name.js";
import { Registry } from "./registry.js";

class JsrError extends AbstractError {
  name = "jsr Error";
}

function getApiEndpoint(registry: string): string {
  const url = new URL(registry);

  url.host = `api.${url.host}`;

  return `${url}`;
}

export class JsrRegisry extends Registry {
  registry = "https://jsr.io";
  client: JsrClient;

  constructor(packageName: string, registry?: string) {
    super(packageName, registry);

    this.client = new JsrClient(getApiEndpoint(this.registry));
  }

  protected async jsr(args: string[]): Promise<string> {
    const { stdout } = await exec("jsr", args, { throwOnError: true });

    return stdout;
  }

  async isInstalled(): Promise<boolean> {
    try {
      await this.jsr(["--version"]);

      return true;
    } catch {
      return false;
    }
  }

  async distTags(): Promise<string[]> {
    return [];
  }

  async ping(): Promise<boolean> {
    try {
      const { stdout } = await exec(
        "ping",
        [new URL(this.registry).hostname, "-c", "1"],
        { throwOnError: true },
      );

      return stdout.includes("1 packets transmitted");
    } catch (error) {
      throw new JsrError(
        `Failed to run \`ping ${new URL(this.registry).hostname}\` -c 1`,
        { cause: error },
      );
    }
  }

  async publish(): Promise<boolean> {
    try {
      await exec(
        "jsr",
        ["publish", "--allow-dirty", "--token", `${JsrClient.token}`],
        {
          throwOnError: true,
        },
      );

      return true;
    } catch (error) {
      const stderr =
        error instanceof NonZeroExitError ? error.output?.stderr : undefined;
      throw new JsrError(
        `Failed to run \`jsr publish --allow-dirty --token ***\`${stderr ? `\n${stderr}` : ""}`,
        {
          cause: error,
        },
      );
    }
  }

  async version(): Promise<string> {
    return await this.jsr(["--version"]);
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

  async hasPermission(): Promise<boolean> {
    return (
      this.client.scopePermission(`${getScope(this.packageName)}`) !== null
    );
  }

  async isPackageNameAvaliable(): Promise<boolean> {
    return isValidPackageName(this.packageName);
  }
}

export class JsrClient {
  static token = new Db().get("jsr-token");

  constructor(public apiEndpoint: string) {}

  protected async fetch(
    endpoint: string,
    init?: RequestInit,
  ): Promise<Response> {
    const pubmVersion = await version({ cwd: import.meta.dirname });

    return fetch(new URL(endpoint, this.apiEndpoint), {
      ...init,
      headers: {
        ...init?.headers,
        Authorization: `Bearer ${JsrClient.token}`,
        "User-Agent": `pubm/${pubmVersion}; https://github.com/syi0808/pubm`,
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

export async function jsrRegistry(): Promise<JsrRegisry> {
  const jsrJson = await getJsrJson();

  return new JsrRegisry(jsrJson.name);
}
