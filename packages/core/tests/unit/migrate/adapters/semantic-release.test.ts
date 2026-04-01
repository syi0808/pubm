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

import { semanticReleaseAdapter } from "../../../../src/migrate/adapters/semantic-release.js";

const CWD = "/fake/project";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("semanticReleaseAdapter.detect()", () => {
  it("detects .releaserc.json", async () => {
    mockedExistsSync.mockImplementation((p) => {
      return p === path.join(CWD, ".releaserc.json");
    });

    const result = await semanticReleaseAdapter.detect(CWD);

    expect(result.found).toBe(true);
    expect(result.configFiles).toContain(path.join(CWD, ".releaserc.json"));
  });

  it("detects release.config.js", async () => {
    mockedExistsSync.mockImplementation((p) => {
      return p === path.join(CWD, "release.config.js");
    });

    const result = await semanticReleaseAdapter.detect(CWD);

    expect(result.found).toBe(true);
    expect(result.configFiles).toContain(path.join(CWD, "release.config.js"));
  });

  it("detects release key in package.json", async () => {
    mockedExistsSync.mockImplementation((p) => {
      return p === path.join(CWD, "package.json");
    });
    mockedReadFileSync.mockImplementation((p) => {
      if (p === path.join(CWD, "package.json")) {
        return JSON.stringify({
          name: "my-pkg",
          release: { branches: ["main"] },
        });
      }
      return "";
    });

    const result = await semanticReleaseAdapter.detect(CWD);

    expect(result.found).toBe(true);
    expect(result.configFiles).toContain(path.join(CWD, "package.json"));
  });

  it("returns found: false when nothing exists", async () => {
    mockedExistsSync.mockReturnValue(false);

    const result = await semanticReleaseAdapter.detect(CWD);

    expect(result.found).toBe(false);
    expect(result.configFiles).toHaveLength(0);
  });
});

describe("semanticReleaseAdapter.parse()", () => {
  it("parses full config with all plugin types", async () => {
    const config = {
      branches: ["main", { name: "beta", prerelease: true }],
      tagFormat: "v${version}",
      plugins: [
        ["@semantic-release/commit-analyzer", { preset: "angular" }],
        "@semantic-release/release-notes-generator",
        ["@semantic-release/npm", { npmPublish: true, pkgRoot: "dist" }],
        [
          "@semantic-release/github",
          { draftRelease: true, assets: ["dist/*.tgz"] },
        ],
        ["@semantic-release/changelog", { changelogFile: "CHANGELOG.md" }],
        [
          "@semantic-release/git",
          { message: "chore(release): ${nextRelease.version}" },
        ],
      ],
    };

    mockedReadFileSync.mockImplementation((p) => {
      if (p === path.join(CWD, ".releaserc.json")) {
        return JSON.stringify(config);
      }
      return "";
    });

    const result = await semanticReleaseAdapter.parse(
      [path.join(CWD, ".releaserc.json")],
      CWD,
    );

    expect(result.source).toBe("semantic-release");
    expect(result.git?.tagFormat).toBe("v${version}");
    expect(result.git?.branch).toBe("main");
    expect(result.git?.commitMessage).toBe(
      "chore(release): ${nextRelease.version}",
    );
    expect(result.npm?.publish).toBe(true);
    expect(result.npm?.publishPath).toBe("dist");
    expect(result.github?.release).toBe(true);
    expect(result.github?.draft).toBe(true);
    expect(result.github?.assets).toEqual(["dist/*.tgz"]);
    expect(result.changelog?.enabled).toBe(true);
    expect(result.changelog?.file).toBe("CHANGELOG.md");
    expect(result.changelog?.preset).toBe("angular");
    expect(result.unmappable).toHaveLength(0);
  });

  it("parses minimal config with string-only plugins (no options)", async () => {
    const config = {
      branches: ["main"],
      plugins: [
        "@semantic-release/commit-analyzer",
        "@semantic-release/release-notes-generator",
        "@semantic-release/npm",
        "@semantic-release/github",
      ],
    };

    mockedReadFileSync.mockImplementation((p) => {
      if (p === path.join(CWD, ".releaserc.json")) {
        return JSON.stringify(config);
      }
      return "";
    });

    const result = await semanticReleaseAdapter.parse(
      [path.join(CWD, ".releaserc.json")],
      CWD,
    );

    expect(result.source).toBe("semantic-release");
    expect(result.git?.branch).toBe("main");
    expect(result.npm?.publish).toBe(true);
    expect(result.github?.release).toBe(true);
    expect(result.unmappable).toHaveLength(0);
  });

  it("handles npmPublish: false → npm.publish: false", async () => {
    const config = {
      plugins: [["@semantic-release/npm", { npmPublish: false }]],
    };

    mockedReadFileSync.mockImplementation((p) => {
      if (p === path.join(CWD, ".releaserc.json")) {
        return JSON.stringify(config);
      }
      return "";
    });

    const result = await semanticReleaseAdapter.parse(
      [path.join(CWD, ".releaserc.json")],
      CWD,
    );

    expect(result.npm?.publish).toBe(false);
  });

  it("extracts exec commands as hooks (prepareCmd, publishCmd, verifyConditionsCmd)", async () => {
    const config = {
      plugins: [
        [
          "@semantic-release/exec",
          {
            prepareCmd: "bun run build",
            publishCmd: "bun run deploy",
            verifyConditionsCmd: "bun test",
          },
        ],
      ],
    };

    mockedReadFileSync.mockImplementation((p) => {
      if (p === path.join(CWD, ".releaserc.json")) {
        return JSON.stringify(config);
      }
      return "";
    });

    const result = await semanticReleaseAdapter.parse(
      [path.join(CWD, ".releaserc.json")],
      CWD,
    );

    expect(result.hooks).toHaveLength(3);
    expect(result.hooks).toContainEqual({
      lifecycle: "prepare",
      command: "bun run build",
    });
    expect(result.hooks).toContainEqual({
      lifecycle: "publish",
      command: "bun run deploy",
    });
    expect(result.hooks).toContainEqual({
      lifecycle: "verifyConditions",
      command: "bun test",
    });
    expect(result.unmappable).toHaveLength(0);
  });

  it("extracts branch from branches array (first non-prerelease, non-maintenance)", async () => {
    const config = {
      branches: [
        { name: "main" },
        { name: "1.x", range: "1.x.x" },
        { name: "beta", prerelease: true },
      ],
      plugins: [],
    };

    mockedReadFileSync.mockImplementation((p) => {
      if (p === path.join(CWD, ".releaserc.json")) {
        return JSON.stringify(config);
      }
      return "";
    });

    const result = await semanticReleaseAdapter.parse(
      [path.join(CWD, ".releaserc.json")],
      CWD,
    );

    expect(result.git?.branch).toBe("main");
  });

  it("extracts prerelease branches", async () => {
    const config = {
      branches: [
        "main",
        { name: "beta", prerelease: true },
        { name: "alpha", prerelease: "alpha" },
      ],
      plugins: [],
    };

    mockedReadFileSync.mockImplementation((p) => {
      if (p === path.join(CWD, ".releaserc.json")) {
        return JSON.stringify(config);
      }
      return "";
    });

    const result = await semanticReleaseAdapter.parse(
      [path.join(CWD, ".releaserc.json")],
      CWD,
    );

    expect(result.prerelease?.branches).toHaveLength(2);
    expect(result.prerelease?.branches).toContainEqual({
      name: "beta",
      prerelease: true,
    });
    expect(result.prerelease?.branches).toContainEqual({
      name: "alpha",
      prerelease: "alpha",
    });
  });

  it("marks unknown plugins as unmappable", async () => {
    const config = {
      plugins: [
        "@semantic-release/npm",
        ["@semantic-release/slack", { notifyOnSuccess: true }],
      ],
    };

    mockedReadFileSync.mockImplementation((p) => {
      if (p === path.join(CWD, ".releaserc.json")) {
        return JSON.stringify(config);
      }
      return "";
    });

    const result = await semanticReleaseAdapter.parse(
      [path.join(CWD, ".releaserc.json")],
      CWD,
    );

    expect(result.unmappable).toHaveLength(1);
    expect(result.unmappable[0]?.key).toMatch(/slack/);
  });

  it("parses YAML config (.releaserc.yml)", async () => {
    const yamlContent = `branches:
  - main
tagFormat: "v\${version}"
plugins:
  - "@semantic-release/commit-analyzer"
  - - "@semantic-release/npm"
    - npmPublish: true
`;

    mockedReadFileSync.mockImplementation((p) => {
      if (p === path.join(CWD, ".releaserc.yml")) {
        return yamlContent;
      }
      return "";
    });

    const result = await semanticReleaseAdapter.parse(
      [path.join(CWD, ".releaserc.yml")],
      CWD,
    );

    expect(result.source).toBe("semantic-release");
    expect(result.git?.branch).toBe("main");
    expect(result.git?.tagFormat).toBe("v${version}");
    expect(result.npm?.publish).toBe(true);
  });

  it("handles .releaserc (try JSON first, fallback YAML)", async () => {
    const yamlContent = `branches:
  - main
plugins:
  - "@semantic-release/npm"
`;

    mockedReadFileSync.mockImplementation((p) => {
      if (p === path.join(CWD, ".releaserc")) {
        return yamlContent;
      }
      return "";
    });

    const result = await semanticReleaseAdapter.parse(
      [path.join(CWD, ".releaserc")],
      CWD,
    );

    expect(result.source).toBe("semantic-release");
    expect(result.git?.branch).toBe("main");
    expect(result.npm?.publish).toBe(true);
  });
});

describe("semanticReleaseAdapter.getCleanupTargets()", () => {
  it("returns config files excluding package.json", () => {
    const detected = {
      found: true,
      configFiles: [
        path.join(CWD, ".releaserc.json"),
        path.join(CWD, "package.json"),
      ],
      relatedFiles: [],
    };

    const targets = semanticReleaseAdapter.getCleanupTargets(detected);

    expect(targets).toContain(path.join(CWD, ".releaserc.json"));
    expect(targets).not.toContain(path.join(CWD, "package.json"));
  });

  it("returns all standalone config files", () => {
    const detected = {
      found: true,
      configFiles: [
        path.join(CWD, ".releaserc.yaml"),
        path.join(CWD, "release.config.js"),
      ],
      relatedFiles: [],
    };

    const targets = semanticReleaseAdapter.getCleanupTargets(detected);

    expect(targets).toEqual([
      path.join(CWD, ".releaserc.yaml"),
      path.join(CWD, "release.config.js"),
    ]);
  });

  it("returns empty array when only package.json detected", () => {
    const detected = {
      found: true,
      configFiles: [path.join(CWD, "package.json")],
      relatedFiles: [],
    };

    const targets = semanticReleaseAdapter.getCleanupTargets(detected);

    expect(targets).toHaveLength(0);
  });
});
