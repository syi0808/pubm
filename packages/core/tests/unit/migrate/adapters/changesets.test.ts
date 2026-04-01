import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    existsSync: vi.fn(),
    readdirSync: vi.fn(),
    readFileSync: vi.fn(),
  };
});

import { existsSync, readdirSync, readFileSync } from "node:fs";

const mockedExistsSync = vi.mocked(existsSync);
const mockedReaddirSync = vi.mocked(readdirSync);
const mockedReadFileSync = vi.mocked(readFileSync);

import { changesetsAdapter } from "../../../../src/migrate/adapters/changesets.js";

const CWD = "/fake/project";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("changesetsAdapter.detect()", () => {
  it("detects .changeset/config.json", async () => {
    const configFile = path.join(CWD, ".changeset", "config.json");

    mockedExistsSync.mockImplementation((p) => p === configFile);
    mockedReaddirSync.mockReturnValue([]);

    const result = await changesetsAdapter.detect(CWD);

    expect(result.found).toBe(true);
    expect(result.configFiles).toContain(configFile);
  });

  it("lists .md files (excluding config.json, README.md) as relatedFiles", async () => {
    const configFile = path.join(CWD, ".changeset", "config.json");

    mockedExistsSync.mockImplementation((p) => p === configFile);
    mockedReaddirSync.mockReturnValue([
      "add-feature.md",
      "fix-bug.md",
      "README.md",
    ] as unknown as ReturnType<typeof readdirSync>);

    const result = await changesetsAdapter.detect(CWD);

    expect(result.relatedFiles).toContain(
      path.join(CWD, ".changeset", "add-feature.md"),
    );
    expect(result.relatedFiles).toContain(
      path.join(CWD, ".changeset", "fix-bug.md"),
    );
    expect(result.relatedFiles).not.toContain(
      path.join(CWD, ".changeset", "README.md"),
    );
  });

  it("includes pre.json in relatedFiles when present", async () => {
    const configFile = path.join(CWD, ".changeset", "config.json");

    mockedExistsSync.mockImplementation((p) => p === configFile);
    mockedReaddirSync.mockReturnValue([
      "add-feature.md",
      "pre.json",
    ] as unknown as ReturnType<typeof readdirSync>);

    const result = await changesetsAdapter.detect(CWD);

    expect(result.relatedFiles).toContain(
      path.join(CWD, ".changeset", "pre.json"),
    );
  });

  it("returns found: false when .changeset/ does not exist", async () => {
    mockedExistsSync.mockReturnValue(false);

    const result = await changesetsAdapter.detect(CWD);

    expect(result.found).toBe(false);
    expect(result.configFiles).toHaveLength(0);
    expect(result.relatedFiles).toHaveLength(0);
  });
});

describe("changesetsAdapter.parse()", () => {
  it("parses full config with fixed/linked/access/baseBranch/updateInternalDependencies", async () => {
    const config = {
      changelog: "@changesets/changelog-git",
      access: "public",
      baseBranch: "main",
      fixed: [["pkg-a", "pkg-b"]],
      linked: [["pkg-c", "pkg-d"]],
      updateInternalDependencies: "minor",
      ignore: [],
    };

    mockedReadFileSync.mockImplementation((p) => {
      if (p === path.join(CWD, ".changeset", "config.json")) {
        return JSON.stringify(config);
      }
      return "";
    });
    mockedExistsSync.mockReturnValue(false); // no pre.json

    const result = await changesetsAdapter.parse(
      [path.join(CWD, ".changeset", "config.json")],
      CWD,
    );

    expect(result.source).toBe("changesets");
    expect(result.npm?.access).toBe("public");
    expect(result.git?.branch).toBe("main");
    expect(result.monorepo?.fixed).toEqual([["pkg-a", "pkg-b"]]);
    expect(result.monorepo?.linked).toEqual([["pkg-c", "pkg-d"]]);
    expect(result.monorepo?.updateInternalDeps).toBe("minor");
    expect(result.changelog?.preset).toBe("git");
  });

  it("maps @changesets/changelog-github -> changelog.preset: 'github'", async () => {
    const config = {
      changelog: "@changesets/changelog-github",
      baseBranch: "main",
    };

    mockedReadFileSync.mockImplementation((p) => {
      if (p === path.join(CWD, ".changeset", "config.json")) {
        return JSON.stringify(config);
      }
      return "";
    });
    mockedExistsSync.mockReturnValue(false);

    const result = await changesetsAdapter.parse(
      [path.join(CWD, ".changeset", "config.json")],
      CWD,
    );

    expect(result.changelog?.enabled).toBe(true);
    expect(result.changelog?.preset).toBe("github");
  });

  it("maps @changesets/changelog-git -> changelog.preset: 'git'", async () => {
    const config = {
      changelog: "@changesets/changelog-git",
      baseBranch: "main",
    };

    mockedReadFileSync.mockImplementation((p) => {
      if (p === path.join(CWD, ".changeset", "config.json")) {
        return JSON.stringify(config);
      }
      return "";
    });
    mockedExistsSync.mockReturnValue(false);

    const result = await changesetsAdapter.parse(
      [path.join(CWD, ".changeset", "config.json")],
      CWD,
    );

    expect(result.changelog?.enabled).toBe(true);
    expect(result.changelog?.preset).toBe("git");
  });

  it("handles changelog: false -> changelog.enabled: false", async () => {
    const config = {
      changelog: false,
      baseBranch: "main",
    };

    mockedReadFileSync.mockImplementation((p) => {
      if (p === path.join(CWD, ".changeset", "config.json")) {
        return JSON.stringify(config);
      }
      return "";
    });
    mockedExistsSync.mockReturnValue(false);

    const result = await changesetsAdapter.parse(
      [path.join(CWD, ".changeset", "config.json")],
      CWD,
    );

    expect(result.changelog?.enabled).toBe(false);
  });

  it("handles changelog as [string, options] tuple", async () => {
    const config = {
      changelog: ["@changesets/changelog-github", { repo: "owner/repo" }],
      baseBranch: "main",
    };

    mockedReadFileSync.mockImplementation((p) => {
      if (p === path.join(CWD, ".changeset", "config.json")) {
        return JSON.stringify(config);
      }
      return "";
    });
    mockedExistsSync.mockReturnValue(false);

    const result = await changesetsAdapter.parse(
      [path.join(CWD, ".changeset", "config.json")],
      CWD,
    );

    expect(result.changelog?.enabled).toBe(true);
    expect(result.changelog?.preset).toBe("github");
  });

  it("detects active prerelease from pre.json (mode: 'pre')", async () => {
    const config = { baseBranch: "main" };
    const preJson = { mode: "pre", tag: "beta" };

    mockedReadFileSync.mockImplementation((p) => {
      if (p === path.join(CWD, ".changeset", "config.json")) {
        return JSON.stringify(config);
      }
      if (p === path.join(CWD, ".changeset", "pre.json")) {
        return JSON.stringify(preJson);
      }
      return "";
    });
    mockedExistsSync.mockImplementation(
      (p) => p === path.join(CWD, ".changeset", "pre.json"),
    );

    const result = await changesetsAdapter.parse(
      [path.join(CWD, ".changeset", "config.json")],
      CWD,
    );

    expect(result.prerelease?.active).toBe(true);
    expect(result.prerelease?.tag).toBe("beta");
  });

  it("does not set prerelease when pre.json mode is 'exit'", async () => {
    const config = { baseBranch: "main" };
    const preJson = { mode: "exit", tag: "beta" };

    mockedReadFileSync.mockImplementation((p) => {
      if (p === path.join(CWD, ".changeset", "config.json")) {
        return JSON.stringify(config);
      }
      if (p === path.join(CWD, ".changeset", "pre.json")) {
        return JSON.stringify(preJson);
      }
      return "";
    });
    mockedExistsSync.mockImplementation(
      (p) => p === path.join(CWD, ".changeset", "pre.json"),
    );

    const result = await changesetsAdapter.parse(
      [path.join(CWD, ".changeset", "config.json")],
      CWD,
    );

    expect(result.prerelease).toBeUndefined();
  });

  it("marks privatePackages as unmappable", async () => {
    const config = {
      baseBranch: "main",
      privatePackages: { version: true, tag: true },
    };

    mockedReadFileSync.mockImplementation((p) => {
      if (p === path.join(CWD, ".changeset", "config.json")) {
        return JSON.stringify(config);
      }
      return "";
    });
    mockedExistsSync.mockReturnValue(false);

    const result = await changesetsAdapter.parse(
      [path.join(CWD, ".changeset", "config.json")],
      CWD,
    );

    expect(result.unmappable.some((u) => u.key === "privatePackages")).toBe(
      true,
    );
  });

  it("handles minimal config (just baseBranch)", async () => {
    const config = { baseBranch: "main" };

    mockedReadFileSync.mockImplementation((p) => {
      if (p === path.join(CWD, ".changeset", "config.json")) {
        return JSON.stringify(config);
      }
      return "";
    });
    mockedExistsSync.mockReturnValue(false);

    const result = await changesetsAdapter.parse(
      [path.join(CWD, ".changeset", "config.json")],
      CWD,
    );

    expect(result.source).toBe("changesets");
    expect(result.git?.branch).toBe("main");
    expect(result.npm).toBeUndefined();
    expect(result.monorepo).toBeUndefined();
    expect(result.changelog).toBeUndefined();
    expect(result.unmappable).toEqual([]);
  });
});

describe("changesetsAdapter.getCleanupTargets()", () => {
  it("returns the .changeset directory path (parent of config.json)", () => {
    const configFile = path.join(CWD, ".changeset", "config.json");
    const detected = {
      found: true,
      configFiles: [configFile],
      relatedFiles: [
        path.join(CWD, ".changeset", "add-feature.md"),
        path.join(CWD, ".changeset", "pre.json"),
      ],
    };

    const targets = changesetsAdapter.getCleanupTargets(detected);

    expect(targets).toContain(path.join(CWD, ".changeset"));
    expect(targets).toHaveLength(1);
  });
});

describe("changesetsAdapter.convert()", () => {
  it("returns empty config and no warnings", () => {
    const parsed = {
      source: "changesets" as const,
      unmappable: [],
    };

    const result = changesetsAdapter.convert(parsed);

    expect(result.config).toEqual({});
    expect(result.warnings).toEqual([]);
  });
});
