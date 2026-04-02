import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
  };
});

import { existsSync, readFileSync } from "node:fs";

const mockedExistsSync = vi.mocked(existsSync);
const mockedReadFileSync = vi.mocked(readFileSync);

import { releaseItAdapter } from "../../../../src/migrate/adapters/release-it.js";

const CWD = "/fake/project";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("releaseItAdapter.detect()", () => {
  it("detects .release-it.json", async () => {
    mockedExistsSync.mockImplementation((p) => {
      return p === path.join(CWD, ".release-it.json");
    });

    const result = await releaseItAdapter.detect(CWD);

    expect(result.found).toBe(true);
    expect(result.configFiles).toContain(path.join(CWD, ".release-it.json"));
  });

  it("detects release-it key in package.json", async () => {
    mockedExistsSync.mockImplementation((p) => {
      return p === path.join(CWD, "package.json");
    });
    mockedReadFileSync.mockImplementation((p) => {
      if (p === path.join(CWD, "package.json")) {
        return JSON.stringify({
          name: "my-pkg",
          "release-it": { npm: { publish: true } },
        });
      }
      return "";
    });

    const result = await releaseItAdapter.detect(CWD);

    expect(result.found).toBe(true);
    expect(result.configFiles).toContain(path.join(CWD, "package.json"));
  });

  it("detects .release-it.yaml", async () => {
    mockedExistsSync.mockImplementation((p) => {
      return p === path.join(CWD, ".release-it.yaml");
    });

    const result = await releaseItAdapter.detect(CWD);

    expect(result.found).toBe(true);
    expect(result.configFiles).toContain(path.join(CWD, ".release-it.yaml"));
  });

  it("returns found: false when nothing exists", async () => {
    mockedExistsSync.mockReturnValue(false);

    const result = await releaseItAdapter.detect(CWD);

    expect(result.found).toBe(false);
    expect(result.configFiles).toHaveLength(0);
  });
});

describe("releaseItAdapter.parse()", () => {
  it("parses full JSON config with git/npm/github/hooks/plugins", async () => {
    const config = {
      git: {
        commitMessage: "chore: release v${version}",
        tagName: "v${version}",
        requireBranch: "main",
        requireCleanWorkingDir: true,
      },
      npm: {
        publish: true,
        publishPath: "dist",
        tag: "latest",
      },
      github: {
        release: true,
        draft: false,
        assets: ["dist/*.tgz"],
      },
      hooks: {
        "before:init": "bun test",
        "after:bump": ["bun run build", "bun run lint"],
      },
      plugins: {
        "@release-it/conventional-changelog": {
          infile: "CHANGELOG.md",
          preset: "angular",
        },
      },
    };

    mockedReadFileSync.mockImplementation((p) => {
      if (p === path.join(CWD, ".release-it.json")) {
        return JSON.stringify(config);
      }
      return "";
    });

    const result = await releaseItAdapter.parse(
      [path.join(CWD, ".release-it.json")],
      CWD,
    );

    expect(result.source).toBe("release-it");
    expect(result.git?.commitMessage).toBe("chore: release v${version}");
    expect(result.git?.tagFormat).toBe("v${version}");
    expect(result.git?.branch).toBe("main");
    expect(result.git?.requireCleanWorkdir).toBe(true);
    expect(result.npm?.publish).toBe(true);
    expect(result.npm?.publishPath).toBe("dist");
    expect(result.npm?.tag).toBe("latest");
    expect(result.github?.release).toBe(true);
    expect(result.github?.draft).toBe(false);
    expect(result.github?.assets).toEqual(["dist/*.tgz"]);
    expect(result.changelog?.enabled).toBe(true);
    expect(result.changelog?.file).toBe("CHANGELOG.md");
    expect(result.changelog?.preset).toBe("angular");
    // hooks: "before:init" => 1 entry, "after:bump" => 2 entries
    expect(result.hooks).toHaveLength(3);
    expect(result.hooks).toContainEqual({
      lifecycle: "before:init",
      command: "bun test",
    });
    expect(result.hooks).toContainEqual({
      lifecycle: "after:bump",
      command: "bun run build",
    });
    expect(result.hooks).toContainEqual({
      lifecycle: "after:bump",
      command: "bun run lint",
    });
    expect(result.unmappable).toHaveLength(0);
  });

  it("handles npm: false → npm.publish: false", async () => {
    const config = { npm: false };

    mockedReadFileSync.mockImplementation((p) => {
      if (p === path.join(CWD, ".release-it.json")) {
        return JSON.stringify(config);
      }
      return "";
    });

    const result = await releaseItAdapter.parse(
      [path.join(CWD, ".release-it.json")],
      CWD,
    );

    expect(result.npm?.publish).toBe(false);
  });

  it("handles github: false → omit github section", async () => {
    const config = { github: false };

    mockedReadFileSync.mockImplementation((p) => {
      if (p === path.join(CWD, ".release-it.json")) {
        return JSON.stringify(config);
      }
      return "";
    });

    const result = await releaseItAdapter.parse(
      [path.join(CWD, ".release-it.json")],
      CWD,
    );

    expect(result.github).toBeUndefined();
  });

  it("uses first branch when requireBranch is an array", async () => {
    const config = { git: { requireBranch: ["main", "master"] } };

    mockedReadFileSync.mockImplementation((p) => {
      if (p === path.join(CWD, ".release-it.json")) {
        return JSON.stringify(config);
      }
      return "";
    });

    const result = await releaseItAdapter.parse(
      [path.join(CWD, ".release-it.json")],
      CWD,
    );

    expect(result.git?.branch).toBe("main");
  });

  it("handles requireBranch: false → no branch set", async () => {
    const config = { git: { requireBranch: false, tagName: "v${version}" } };

    mockedReadFileSync.mockImplementation((p) => {
      if (p === path.join(CWD, ".release-it.json")) {
        return JSON.stringify(config);
      }
      return "";
    });

    const result = await releaseItAdapter.parse(
      [path.join(CWD, ".release-it.json")],
      CWD,
    );

    expect(result.git?.branch).toBeUndefined();
    expect(result.git?.tagFormat).toBe("v${version}");
  });

  it("extracts @release-it/conventional-changelog plugin → changelog fields", async () => {
    const config = {
      plugins: {
        "@release-it/conventional-changelog": {
          infile: "HISTORY.md",
          preset: "conventionalcommits",
        },
      },
    };

    mockedReadFileSync.mockImplementation((p) => {
      if (p === path.join(CWD, ".release-it.json")) {
        return JSON.stringify(config);
      }
      return "";
    });

    const result = await releaseItAdapter.parse(
      [path.join(CWD, ".release-it.json")],
      CWD,
    );

    expect(result.changelog?.enabled).toBe(true);
    expect(result.changelog?.file).toBe("HISTORY.md");
    expect(result.changelog?.preset).toBe("conventionalcommits");
    expect(result.unmappable).toHaveLength(0);
  });

  it("marks other plugins as unmappable", async () => {
    const config = {
      plugins: {
        "@release-it/bumper": { out: { file: "package.json" } },
      },
    };

    mockedReadFileSync.mockImplementation((p) => {
      if (p === path.join(CWD, ".release-it.json")) {
        return JSON.stringify(config);
      }
      return "";
    });

    const result = await releaseItAdapter.parse(
      [path.join(CWD, ".release-it.json")],
      CWD,
    );

    expect(result.unmappable).toHaveLength(1);
    expect(result.unmappable[0]?.key).toBe("plugins.@release-it/bumper");
  });

  it("marks gitlab section as unmappable", async () => {
    const config = {
      gitlab: {
        release: true,
      },
    };

    mockedReadFileSync.mockImplementation((p) => {
      if (p === path.join(CWD, ".release-it.json")) {
        return JSON.stringify(config);
      }
      return "";
    });

    const result = await releaseItAdapter.parse(
      [path.join(CWD, ".release-it.json")],
      CWD,
    );

    expect(result.unmappable).toHaveLength(1);
    expect(result.unmappable[0]?.key).toBe("gitlab");
    expect(result.unmappable[0]?.reason).toMatch(/GitLab/i);
  });

  it("flattens hooks — string[] values become individual entries", async () => {
    const config = {
      hooks: {
        "before:init": ["cmd1", "cmd2"],
        "after:release": "cmd3",
      },
    };

    mockedReadFileSync.mockImplementation((p) => {
      if (p === path.join(CWD, ".release-it.json")) {
        return JSON.stringify(config);
      }
      return "";
    });

    const result = await releaseItAdapter.parse(
      [path.join(CWD, ".release-it.json")],
      CWD,
    );

    expect(result.hooks).toHaveLength(3);
    expect(result.hooks).toContainEqual({
      lifecycle: "before:init",
      command: "cmd1",
    });
    expect(result.hooks).toContainEqual({
      lifecycle: "before:init",
      command: "cmd2",
    });
    expect(result.hooks).toContainEqual({
      lifecycle: "after:release",
      command: "cmd3",
    });
  });

  it("returns unmappable warning when .release-it.js cannot be dynamically imported", async () => {
    const configFile = path.join(CWD, ".release-it.js");
    const result = await releaseItAdapter.parse([configFile], CWD);

    expect(result.source).toBe("release-it");
    expect(result.unmappable).toHaveLength(1);
    expect(result.unmappable[0].key).toBe(configFile);
    expect(result.unmappable[0].reason).toContain(
      "Could not parse JS/TS config file",
    );
  });

  it("returns unmappable warning when .release-it.cjs cannot be dynamically imported", async () => {
    const configFile = path.join(CWD, ".release-it.cjs");
    const result = await releaseItAdapter.parse([configFile], CWD);

    expect(result.source).toBe("release-it");
    expect(result.unmappable).toHaveLength(1);
    expect(result.unmappable[0].key).toBe(configFile);
    expect(result.unmappable[0].reason).toContain(
      "Could not parse JS/TS config file",
    );
  });

  it("returns unmappable warning when .release-it.ts cannot be dynamically imported", async () => {
    const configFile = path.join(CWD, ".release-it.ts");
    const result = await releaseItAdapter.parse([configFile], CWD);

    expect(result.source).toBe("release-it");
    expect(result.unmappable).toHaveLength(1);
    expect(result.unmappable[0].key).toBe(configFile);
    expect(result.unmappable[0].reason).toContain(
      "Could not parse JS/TS config file",
    );
  });

  it("parses YAML config", async () => {
    const yamlContent = `git:
  tagName: "v\${version}"
  requireBranch: main
npm:
  publish: true
  tag: beta
`;

    mockedReadFileSync.mockImplementation((p) => {
      if (p === path.join(CWD, ".release-it.yaml")) {
        return yamlContent;
      }
      return "";
    });

    const result = await releaseItAdapter.parse(
      [path.join(CWD, ".release-it.yaml")],
      CWD,
    );

    expect(result.source).toBe("release-it");
    expect(result.git?.tagFormat).toBe("v${version}");
    expect(result.git?.branch).toBe("main");
    expect(result.npm?.publish).toBe(true);
    expect(result.npm?.tag).toBe("beta");
  });

  it("handles git with no mapped fields → no git section set", async () => {
    const config = { git: {} };

    mockedReadFileSync.mockImplementation((p) => {
      if (p === path.join(CWD, ".release-it.json")) {
        return JSON.stringify(config);
      }
      return "";
    });

    const result = await releaseItAdapter.parse(
      [path.join(CWD, ".release-it.json")],
      CWD,
    );

    expect(result.git).toBeUndefined();
  });

  it("handles github section with no draft or assets", async () => {
    const config = { github: { release: true } };

    mockedReadFileSync.mockImplementation((p) => {
      if (p === path.join(CWD, ".release-it.json")) {
        return JSON.stringify(config);
      }
      return "";
    });

    const result = await releaseItAdapter.parse(
      [path.join(CWD, ".release-it.json")],
      CWD,
    );

    expect(result.github?.release).toBe(true);
    expect(result.github?.draft).toBeUndefined();
    expect(result.github?.assets).toBeUndefined();
  });

  it("parses release-it config from package.json", async () => {
    const pkgContent = {
      name: "my-pkg",
      "release-it": {
        npm: { publish: true },
        github: { release: true },
      },
    };

    mockedReadFileSync.mockImplementation((p) => {
      if (p === path.join(CWD, "package.json")) {
        return JSON.stringify(pkgContent);
      }
      return "";
    });

    const result = await releaseItAdapter.parse(
      [path.join(CWD, "package.json")],
      CWD,
    );

    expect(result.source).toBe("release-it");
    expect(result.npm?.publish).toBe(true);
    expect(result.github?.release).toBe(true);
  });

  it("handles @release-it/conventional-changelog without infile or preset", async () => {
    const config = {
      plugins: {
        "@release-it/conventional-changelog": {},
      },
    };

    mockedReadFileSync.mockImplementation((p) => {
      if (p === path.join(CWD, ".release-it.json")) {
        return JSON.stringify(config);
      }
      return "";
    });

    const result = await releaseItAdapter.parse(
      [path.join(CWD, ".release-it.json")],
      CWD,
    );

    expect(result.changelog?.enabled).toBe(true);
    expect(result.changelog?.file).toBeUndefined();
    expect(result.changelog?.preset).toBeUndefined();
  });
});

describe("releaseItAdapter.getCleanupTargets()", () => {
  it("returns config files excluding package.json", () => {
    const detected = {
      found: true,
      configFiles: [
        path.join(CWD, ".release-it.json"),
        path.join(CWD, "package.json"),
      ],
      relatedFiles: [],
    };

    const targets = releaseItAdapter.getCleanupTargets(detected);

    expect(targets).toContain(path.join(CWD, ".release-it.json"));
    expect(targets).not.toContain(path.join(CWD, "package.json"));
  });

  it("returns all standalone config files", () => {
    const detected = {
      found: true,
      configFiles: [path.join(CWD, ".release-it.yaml")],
      relatedFiles: [],
    };

    const targets = releaseItAdapter.getCleanupTargets(detected);

    expect(targets).toEqual([path.join(CWD, ".release-it.yaml")]);
  });

  it("returns empty array when only package.json detected", () => {
    const detected = {
      found: true,
      configFiles: [path.join(CWD, "package.json")],
      relatedFiles: [],
    };

    const targets = releaseItAdapter.getCleanupTargets(detected);

    expect(targets).toHaveLength(0);
  });
});

describe("releaseItAdapter.convert()", () => {
  it("returns empty config and no warnings", () => {
    const parsed = {
      source: "release-it" as const,
      unmappable: [],
    };

    const result = releaseItAdapter.convert(parsed);

    expect(result.config).toEqual({});
    expect(result.warnings).toEqual([]);
  });
});
