import { beforeEach, describe, expect, it, vi } from "vitest";

const { originalStatSync } = vi.hoisted(() => {
  const fs = require("node:fs");
  return { originalStatSync: fs.statSync };
});

vi.mock("node:fs", async (importOriginal) => {
  const original = (await importOriginal()) as typeof import("node:fs");
  return {
    ...original,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    readdirSync: vi.fn(),
    statSync: vi.fn((...args: unknown[]) => {
      const p = String(args[0]);
      if (!p.replaceAll("\\", "/").includes("/mock-workspace")) {
        return originalStatSync(
          ...(args as Parameters<typeof originalStatSync>),
        );
      }
      return { isDirectory: () => true };
    }),
  };
});

vi.mock("../../../src/monorepo/workspace.js", () => ({
  detectWorkspace: vi.fn(),
}));

vi.mock("../../../src/monorepo/discover.js", () => ({
  resolvePatterns: vi.fn(),
}));

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolvePatterns } from "../../../src/monorepo/discover.js";
import {
  collectWorkspaceVersions,
  resolveWorkspaceProtocol,
  resolveWorkspaceProtocolsInManifests,
  restoreManifests,
} from "../../../src/monorepo/resolve-workspace.js";
import { detectWorkspace } from "../../../src/monorepo/workspace.js";

// ─── resolveWorkspaceProtocol ───

describe("resolveWorkspaceProtocol", () => {
  const version = "1.5.0";

  it("resolves workspace:* to exact version", () => {
    expect(resolveWorkspaceProtocol("workspace:*", version)).toBe("1.5.0");
  });

  it("resolves workspace:^ to caret range", () => {
    expect(resolveWorkspaceProtocol("workspace:^", version)).toBe("^1.5.0");
  });

  it("resolves workspace:~ to tilde range", () => {
    expect(resolveWorkspaceProtocol("workspace:~", version)).toBe("~1.5.0");
  });

  it("strips workspace: prefix from explicit caret range", () => {
    expect(resolveWorkspaceProtocol("workspace:^1.2.0", version)).toBe(
      "^1.2.0",
    );
  });

  it("strips workspace: prefix from explicit tilde range", () => {
    expect(resolveWorkspaceProtocol("workspace:~1.2.0", version)).toBe(
      "~1.2.0",
    );
  });

  it("strips workspace: prefix from explicit version", () => {
    expect(resolveWorkspaceProtocol("workspace:1.2.0", version)).toBe("1.2.0");
  });

  it("returns spec unchanged when no workspace: prefix", () => {
    expect(resolveWorkspaceProtocol("^1.0.0", version)).toBe("^1.0.0");
  });
});

// ─── collectWorkspaceVersions ───

describe("collectWorkspaceVersions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty map when no workspaces detected", () => {
    vi.mocked(detectWorkspace).mockReturnValue([]);
    const result = collectWorkspaceVersions("/mock-workspace");
    expect(result.size).toBe(0);
  });

  it("builds name→version map from workspace packages", () => {
    vi.mocked(detectWorkspace).mockReturnValue([
      { type: "bun", patterns: ["packages/*"] },
    ]);
    vi.mocked(resolvePatterns).mockReturnValue([
      "/mock-workspace/packages/core",
      "/mock-workspace/packages/cli",
    ]);
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockImplementation((filePath: any) => {
      const normalized = String(filePath).replaceAll("\\", "/");
      if (normalized.includes("packages/core")) {
        return JSON.stringify({ name: "@pubm/core", version: "0.4.2" });
      }
      if (normalized.includes("packages/cli")) {
        return JSON.stringify({ name: "pubm", version: "0.4.2" });
      }
      return "{}";
    });

    const result = collectWorkspaceVersions("/mock-workspace");
    expect(result.get("@pubm/core")).toBe("0.4.2");
    expect(result.get("pubm")).toBe("0.4.2");
  });

  it("skips directories without package.json", () => {
    vi.mocked(detectWorkspace).mockReturnValue([
      { type: "bun", patterns: ["packages/*"] },
    ]);
    vi.mocked(resolvePatterns).mockReturnValue([
      "/mock-workspace/packages/empty",
    ]);
    vi.mocked(existsSync).mockReturnValue(false);

    const result = collectWorkspaceVersions("/mock-workspace");
    expect(result.size).toBe(0);
  });

  it("skips packages with missing name or version", () => {
    vi.mocked(detectWorkspace).mockReturnValue([
      { type: "bun", patterns: ["packages/*"] },
    ]);
    vi.mocked(resolvePatterns).mockReturnValue([
      "/mock-workspace/packages/broken",
    ]);
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({ name: "broken-pkg" }),
    );

    const result = collectWorkspaceVersions("/mock-workspace");
    expect(result.size).toBe(0);
  });
});

// ─── resolveWorkspaceProtocolsInManifests ───

describe("resolveWorkspaceProtocolsInManifests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("replaces workspace: specs in all dependency fields", () => {
    const manifest = {
      name: "pubm",
      version: "0.4.2",
      dependencies: { "@pubm/core": "workspace:*" },
      devDependencies: { "@pubm/utils": "workspace:^" },
      optionalDependencies: { "@pubm/darwin-arm64": "workspace:~" },
      peerDependencies: { "@pubm/peer": "workspace:^1.0.0" },
    };

    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(manifest, null, 2));

    const versions = new Map([
      ["@pubm/core", "0.4.2"],
      ["@pubm/utils", "0.4.2"],
      ["@pubm/darwin-arm64", "0.4.2"],
    ]);

    const backups = resolveWorkspaceProtocolsInManifests(
      ["/mock-workspace/packages/cli"],
      versions,
    );

    expect(backups.size).toBe(1);
    expect(vi.mocked(writeFileSync)).toHaveBeenCalledTimes(1);

    const writtenContent = JSON.parse(
      vi.mocked(writeFileSync).mock.calls[0][1] as string,
    );
    expect(writtenContent.dependencies["@pubm/core"]).toBe("0.4.2");
    expect(writtenContent.devDependencies["@pubm/utils"]).toBe("^0.4.2");
    expect(writtenContent.optionalDependencies["@pubm/darwin-arm64"]).toBe(
      "~0.4.2",
    );
    expect(writtenContent.peerDependencies["@pubm/peer"]).toBe("^1.0.0");
  });

  it("skips manifests with no workspace: dependencies", () => {
    const manifest = {
      name: "pubm",
      version: "0.4.2",
      dependencies: { commander: "^14.0.0" },
    };

    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(manifest, null, 2));

    const backups = resolveWorkspaceProtocolsInManifests(
      ["/mock-workspace/packages/cli"],
      new Map(),
    );

    expect(backups.size).toBe(0);
    expect(vi.mocked(writeFileSync)).not.toHaveBeenCalled();
  });

  it("throws when dynamic workspace: spec references unknown package", () => {
    const manifest = {
      name: "pubm",
      version: "0.4.2",
      dependencies: { "@pubm/unknown": "workspace:*" },
    };

    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(manifest, null, 2));

    expect(() =>
      resolveWorkspaceProtocolsInManifests(
        ["/mock-workspace/packages/cli"],
        new Map(),
      ),
    ).toThrow("@pubm/unknown");
  });

  it("allows static workspace: spec for unknown packages", () => {
    const manifest = {
      name: "pubm",
      version: "0.4.2",
      dependencies: { "@pubm/unknown": "workspace:^1.0.0" },
    };

    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(manifest, null, 2));

    const backups = resolveWorkspaceProtocolsInManifests(
      ["/mock-workspace/packages/cli"],
      new Map(),
    );

    expect(backups.size).toBe(1);
    const writtenContent = JSON.parse(
      vi.mocked(writeFileSync).mock.calls[0][1] as string,
    );
    expect(writtenContent.dependencies["@pubm/unknown"]).toBe("^1.0.0");
  });
});

// ─── restoreManifests ───

describe("restoreManifests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes original contents back to files", () => {
    const original =
      '{"name":"pubm","dependencies":{"@pubm/core":"workspace:*"}}';
    const backups = new Map([
      ["/mock-workspace/packages/cli/package.json", original],
    ]);

    restoreManifests(backups);

    expect(vi.mocked(writeFileSync)).toHaveBeenCalledWith(
      "/mock-workspace/packages/cli/package.json",
      original,
      "utf-8",
    );
  });
});
