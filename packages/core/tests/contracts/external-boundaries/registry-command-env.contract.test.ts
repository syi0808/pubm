import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PreparedAsset } from "../../../src/assets/types.js";

const contractState = vi.hoisted(() => {
  const execCalls: {
    command: string;
    args: string[];
    options?: {
      throwOnError?: boolean;
      nodeOptions?: {
        cwd?: string;
        env?: Record<string, string | undefined>;
      };
    };
  }[] = [];

  return {
    execCalls,
    reset() {
      execCalls.length = 0;
    },
  };
});

vi.mock("../../../src/utils/exec.js", () => ({
  exec: vi.fn(async (command: string, args: string[] = [], options = {}) => {
    contractState.execCalls.push({ command, args, options });
    return { stdout: "contract-stdout\n", stderr: "", exitCode: 0 };
  }),
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    readFileSync: vi.fn(() => Buffer.from("archive-bytes")),
  };
});

vi.mock("../../../src/git.js", () => ({
  Git: vi.fn(
    class MockGit {
      repository = vi
        .fn()
        .mockResolvedValue("https://github.com/acme/widgets.git");
    },
  ),
}));

import {
  RegistryCatalog,
  registerPrivateRegistry,
} from "../../../src/registry/catalog.js";
import { CratesPackageRegistry } from "../../../src/registry/crates.js";
import { CustomPackageRegistry } from "../../../src/registry/custom-registry.js";
import { JsrClient, JsrPackageRegistry } from "../../../src/registry/jsr.js";
import { NpmPackageRegistry } from "../../../src/registry/npm.js";
import {
  createGitHubRelease,
  deleteGitHubRelease,
} from "../../../src/tasks/github-release.js";

const managedEnvVars = [
  "GITHUB_TOKEN",
  "JSR_TOKEN",
  "CARGO_REGISTRY_TOKEN",
  "PRIVATE_NPM_TOKEN",
] as const;

const savedEnv = new Map<string, string | undefined>();

function saveManagedEnv(): void {
  savedEnv.clear();
  for (const key of managedEnvVars) {
    savedEnv.set(key, process.env[key]);
    delete process.env[key];
  }
}

function restoreManagedEnv(): void {
  for (const key of managedEnvVars) {
    const value = savedEnv.get(key);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  contractState.reset();
  saveManagedEnv();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("Unexpected external fetch in boundary contract test");
    }),
  );
  JsrClient.token = null;
});

afterEach(() => {
  restoreManagedEnv();
  JsrClient.token = null;
});

function githubReleaseAsset(name = "widget.tar.gz"): PreparedAsset {
  return {
    filePath: "/tmp/widget.tar.gz",
    name,
    sha256: "abc123def456abc123def456abc123def456abc123def456abc123def456abcd",
    platform: { raw: "linux-x64", os: "linux", arch: "x64" },
    originalPath: "/tmp/widget",
    compressFormat: "tar.gz",
    config: { path: "/tmp/widget", compress: "tar.gz", name: "widget" },
  };
}

describe("registry command and env boundary contract", () => {
  it("pins npm publish, provenance publish, custom registry, and unpublish command shapes", async () => {
    const npm = new NpmPackageRegistry("@acme/widget", "/repo/pkg");

    await npm.publish("123456", "next");
    await npm.publishProvenance("beta");
    await npm.unpublish("@acme/widget", "1.2.3");

    const custom = new CustomPackageRegistry(
      "@acme/private-widget",
      "/repo/private",
      "https://npm.internal.example",
    );
    await custom.publish(undefined, "canary");

    expect(contractState.execCalls).toEqual([
      {
        command: "npm",
        args: ["publish", "--otp", "123456", "--tag", "next"],
        options: {
          throwOnError: true,
          nodeOptions: { cwd: "/repo/pkg" },
        },
      },
      {
        command: "npm",
        args: [
          "publish",
          "--provenance",
          "--access",
          "public",
          "--tag",
          "beta",
        ],
        options: {
          throwOnError: true,
          nodeOptions: { cwd: "/repo/pkg" },
        },
      },
      {
        command: "npm",
        args: ["unpublish", "@acme/widget@1.2.3"],
        options: {
          throwOnError: true,
          nodeOptions: { cwd: "/repo/pkg" },
        },
      },
      {
        command: "npm",
        args: [
          "publish",
          "--tag",
          "canary",
          "--registry",
          "https://npm.internal.example",
        ],
        options: {
          throwOnError: true,
          nodeOptions: { cwd: "/repo/private" },
        },
      },
    ]);
  });

  it("pins jsr and crates publish command shapes", async () => {
    JsrClient.token = "jsr-contract-token";
    const jsr = new JsrPackageRegistry("@acme/widget", "/repo/jsr");
    const crates = new CratesPackageRegistry("widget", "/repo/crate");

    await jsr.publish();
    await jsr.dryRunPublish();
    await crates.publish();
    await crates.dryRunPublish();
    await crates.unpublish("widget", "1.2.3");

    expect(contractState.execCalls).toEqual([
      {
        command: "jsr",
        args: [
          "publish",
          "--allow-dirty",
          "--allow-slow-types",
          "--token",
          "jsr-contract-token",
        ],
        options: {
          throwOnError: true,
          nodeOptions: { cwd: "/repo/jsr" },
        },
      },
      {
        command: "jsr",
        args: [
          "publish",
          "--dry-run",
          "--allow-dirty",
          "--allow-slow-types",
          "--token",
          "jsr-contract-token",
        ],
        options: {
          throwOnError: true,
          nodeOptions: { cwd: "/repo/jsr" },
        },
      },
      {
        command: "cargo",
        args: [
          "publish",
          "--manifest-path",
          path.join("/repo/crate", "Cargo.toml"),
        ],
        options: { throwOnError: true },
      },
      {
        command: "cargo",
        args: [
          "publish",
          "--dry-run",
          "--manifest-path",
          path.join("/repo/crate", "Cargo.toml"),
        ],
        options: { throwOnError: true },
      },
      {
        command: "cargo",
        args: [
          "yank",
          "--vers",
          "1.2.3",
          "--manifest-path",
          path.join("/repo/crate", "Cargo.toml"),
        ],
        options: { throwOnError: true },
      },
    ]);
  });

  it("pins private registry URL and token env descriptor semantics", async () => {
    const catalog = new RegistryCatalog();

    const key = registerPrivateRegistry(
      {
        url: "https://npm.internal.example/",
        token: { envVar: "PRIVATE_NPM_TOKEN" },
      },
      "js",
      catalog,
    );

    const descriptor = catalog.get(key);

    expect(key).toBe("npm.internal.example");
    expect(descriptor).toMatchObject({
      key: "npm.internal.example",
      ecosystem: "js",
      label: "https://npm.internal.example/",
      tokenConfig: {
        envVar: "PRIVATE_NPM_TOKEN",
        dbKey: "npm.internal.example-token",
        ghSecretName: "PRIVATE_NPM_TOKEN",
        promptLabel: "Token for https://npm.internal.example/",
        tokenUrl: "https://npm.internal.example/",
        tokenUrlLabel: "npm.internal.example",
      },
      concurrentPublish: true,
      requiresEarlyAuth: false,
    });
  });
});

describe("GitHub release API boundary contract", () => {
  it("pins create payload, asset upload request, and returned release context", async () => {
    process.env.GITHUB_TOKEN = "github-contract-token";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: vi.fn().mockResolvedValue({
          id: 42,
          html_url: "https://github.com/acme/widgets/releases/tag/v1.2.3",
          upload_url:
            "https://uploads.github.com/repos/acme/widgets/releases/42/assets{?name,label}",
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: vi.fn().mockResolvedValue({
          browser_download_url:
            "https://github.com/acme/widgets/releases/download/v1.2.3/widget.tar.gz",
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const platform = { raw: "linux-x64", os: "linux", arch: "x64" };
    const result = await createGitHubRelease({} as never, {
      displayLabel: "widgets",
      version: "1.2.3-beta.1",
      tag: "v1.2.3",
      body: "Contract release notes",
      draft: true,
      assets: [
        {
          filePath: "/tmp/widget.tar.gz",
          name: "widget linux.tar.gz",
          sha256:
            "abc123def456abc123def456abc123def456abc123def456abc123def456abcd",
          platform,
          originalPath: "/tmp/widget",
          compressFormat: "tar.gz",
          config: { path: "/tmp/widget", compress: "tar.gz", name: "widget" },
        },
      ],
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]).toEqual([
      "https://api.github.com/repos/acme/widgets/releases",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer github-contract-token",
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify({
          tag_name: "v1.2.3",
          name: "v1.2.3",
          body: "Contract release notes",
          draft: true,
          prerelease: true,
        }),
      },
    ]);
    expect(fetchMock.mock.calls[1]).toEqual([
      "https://uploads.github.com/repos/acme/widgets/releases/42/assets?name=widget%20linux.tar.gz",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer github-contract-token",
          Accept: "application/vnd.github+json",
          "Content-Type": "application/octet-stream",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: Buffer.from("archive-bytes"),
      },
    ]);
    expect(result).toEqual({
      displayLabel: "widgets",
      version: "1.2.3-beta.1",
      tag: "v1.2.3",
      releaseUrl: "https://github.com/acme/widgets/releases/tag/v1.2.3",
      releaseId: 42,
      assets: [
        {
          name: "widget linux.tar.gz",
          url: "https://github.com/acme/widgets/releases/download/v1.2.3/widget.tar.gz",
          sha256:
            "abc123def456abc123def456abc123def456abc123def456abc123def456abcd",
          platform,
        },
      ],
    });
  });

  it("throws a meaningful create error and does not upload assets after GitHub rejects the release", async () => {
    process.env.GITHUB_TOKEN = "github-contract-token";
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 422,
      text: vi.fn().mockResolvedValue(
        JSON.stringify({
          message: "Validation Failed",
          errors: [
            {
              resource: "Release",
              field: "tag_name",
              code: "invalid",
              message: "tag is invalid",
            },
          ],
        }),
      ),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createGitHubRelease({} as never, {
        displayLabel: "widgets",
        version: "1.2.3",
        tag: "v1.2.3",
        body: "Contract release notes",
        assets: [githubReleaseAsset()],
      }),
    ).rejects.toThrow(
      /Failed to create GitHub Release \(422\): .*tag is invalid/,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://api.github.com/repos/acme/widgets/releases",
    );
  });

  it("deletes the created release when asset upload fails", async () => {
    process.env.GITHUB_TOKEN = "github-contract-token";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: vi.fn().mockResolvedValue({
          id: 77,
          html_url: "https://github.com/acme/widgets/releases/tag/v1.2.3",
          upload_url:
            "https://uploads.github.com/repos/acme/widgets/releases/77/assets{?name,label}",
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 502,
        text: vi.fn().mockResolvedValue("upload failed"),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 204,
      });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createGitHubRelease({} as never, {
        displayLabel: "widgets",
        version: "1.2.3",
        tag: "v1.2.3",
        body: "Contract release notes",
        assets: [githubReleaseAsset("widget linux.tar.gz")],
      }),
    ).rejects.toThrow(
      /Failed to upload asset widget linux\.tar\.gz \(502\): upload failed/,
    );

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "https://uploads.github.com/repos/acme/widgets/releases/77/assets?name=widget%20linux.tar.gz",
    );
    expect(fetchMock.mock.calls[2]).toEqual([
      "https://api.github.com/repos/acme/widgets/releases/77",
      {
        method: "DELETE",
        headers: {
          Authorization: "Bearer github-contract-token",
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
    ]);
  });

  it("fails before any fetch when GITHUB_TOKEN is missing", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createGitHubRelease({} as never, {
        displayLabel: "widgets",
        version: "1.2.3",
        tag: "v1.2.3",
        body: "Contract release notes",
        assets: [githubReleaseAsset()],
      }),
    ).rejects.toThrow(/GITHUB_TOKEN environment variable is required/);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("pins delete request and treats GitHub 404 as already deleted", async () => {
    process.env.GITHUB_TOKEN = "github-contract-token";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: vi.fn().mockResolvedValue("not found"),
    });
    vi.stubGlobal("fetch", fetchMock);

    await deleteGitHubRelease(42);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.github.com/repos/acme/widgets/releases/42",
      {
        method: "DELETE",
        headers: {
          Authorization: "Bearer github-contract-token",
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
    );
  });
});
