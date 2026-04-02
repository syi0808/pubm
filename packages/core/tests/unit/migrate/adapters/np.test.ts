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

import { npAdapter } from "../../../../src/migrate/adapters/np.js";

const CWD = "/fake/project";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("npAdapter.detect()", () => {
  it("detects np config in package.json when np key is present", async () => {
    mockedExistsSync.mockImplementation((p) => {
      return p === path.join(CWD, "package.json");
    });
    mockedReadFileSync.mockImplementation((p) => {
      if (p === path.join(CWD, "package.json")) {
        return JSON.stringify({ name: "my-pkg", np: { branch: "main" } });
      }
      return "";
    });

    const result = await npAdapter.detect(CWD);

    expect(result.found).toBe(true);
    expect(result.configFiles).toContain(path.join(CWD, "package.json"));
  });

  it("detects .np-config.json file", async () => {
    mockedExistsSync.mockImplementation((p) => {
      return p === path.join(CWD, ".np-config.json");
    });

    const result = await npAdapter.detect(CWD);

    expect(result.found).toBe(true);
    expect(result.configFiles).toContain(path.join(CWD, ".np-config.json"));
  });

  it("returns found: false when no np config exists", async () => {
    mockedExistsSync.mockReturnValue(false);

    const result = await npAdapter.detect(CWD);

    expect(result.found).toBe(false);
    expect(result.configFiles).toHaveLength(0);
  });

  it("does NOT detect package.json without an np key", async () => {
    mockedExistsSync.mockImplementation((p) => {
      return p === path.join(CWD, "package.json");
    });
    mockedReadFileSync.mockImplementation((p) => {
      if (p === path.join(CWD, "package.json")) {
        return JSON.stringify({ name: "my-pkg", version: "1.0.0" });
      }
      return "";
    });

    const result = await npAdapter.detect(CWD);

    expect(result.found).toBe(false);
    expect(result.configFiles).toHaveLength(0);
  });

  it("returns empty relatedFiles", async () => {
    mockedExistsSync.mockReturnValue(false);

    const result = await npAdapter.detect(CWD);

    expect(result.relatedFiles).toEqual([]);
  });

  it("detects .np-config.js file", async () => {
    mockedExistsSync.mockImplementation((p) => {
      return p === path.join(CWD, ".np-config.js");
    });

    const result = await npAdapter.detect(CWD);

    expect(result.found).toBe(true);
    expect(result.configFiles).toContain(path.join(CWD, ".np-config.js"));
  });

  it("detects .np-config.cjs file", async () => {
    mockedExistsSync.mockImplementation((p) => {
      return p === path.join(CWD, ".np-config.cjs");
    });

    const result = await npAdapter.detect(CWD);

    expect(result.found).toBe(true);
    expect(result.configFiles).toContain(path.join(CWD, ".np-config.cjs"));
  });
});

describe("npAdapter.parse()", () => {
  it("parses package.json np config with all fields", async () => {
    const npConfig = {
      branch: "main",
      tests: true,
      testScript: "bun test",
      publish: true,
      tag: "latest",
      contents: "dist",
      releaseDraft: true,
      message: "chore: release v%s",
      anyBranch: false,
      cleanup: true,
    };

    mockedReadFileSync.mockImplementation((p) => {
      if (p === path.join(CWD, "package.json")) {
        return JSON.stringify({ name: "my-pkg", np: npConfig });
      }
      return "";
    });

    const result = await npAdapter.parse([path.join(CWD, "package.json")], CWD);

    expect(result.source).toBe("np");
    expect(result.git?.branch).toBe("main");
    expect(result.git?.commitMessage).toBe("chore: release v%s");
    expect(result.tests?.enabled).toBe(true);
    expect(result.tests?.script).toBe("bun test");
    expect(result.npm?.publish).toBe(true);
    expect(result.npm?.tag).toBe("latest");
    expect(result.npm?.publishPath).toBe("dist");
    expect(result.github?.release).toBe(true);
    expect(result.github?.draft).toBe(true);
    expect(result.unmappable).toEqual([]);
  });

  it("parses .np-config.json standalone file", async () => {
    const npConfig = { branch: "main", publish: false };

    mockedReadFileSync.mockImplementation((p) => {
      if (p === path.join(CWD, ".np-config.json")) {
        return JSON.stringify(npConfig);
      }
      return "";
    });

    const result = await npAdapter.parse(
      [path.join(CWD, ".np-config.json")],
      CWD,
    );

    expect(result.source).toBe("np");
    expect(result.git?.branch).toBe("main");
    expect(result.npm?.publish).toBe(false);
  });

  it("marks 2fa as unmappable", async () => {
    const npConfig = { branch: "main", "2fa": true };

    mockedReadFileSync.mockImplementation((p) => {
      if (p === path.join(CWD, ".np-config.json")) {
        return JSON.stringify(npConfig);
      }
      return "";
    });

    const result = await npAdapter.parse(
      [path.join(CWD, ".np-config.json")],
      CWD,
    );

    expect(result.unmappable).toHaveLength(1);
    expect(result.unmappable[0]?.key).toBe("2fa");
  });

  it("marks provenance as unmappable", async () => {
    const npConfig = { branch: "main", provenance: true };

    mockedReadFileSync.mockImplementation((p) => {
      if (p === path.join(CWD, ".np-config.json")) {
        return JSON.stringify(npConfig);
      }
      return "";
    });

    const result = await npAdapter.parse(
      [path.join(CWD, ".np-config.json")],
      CWD,
    );

    expect(result.unmappable).toHaveLength(1);
    expect(result.unmappable[0]?.key).toBe("provenance");
  });

  it("ignores runtime-only options (yolo, preview) — they do NOT appear in unmappable", async () => {
    const npConfig = { branch: "main", yolo: true, preview: true };

    mockedReadFileSync.mockImplementation((p) => {
      if (p === path.join(CWD, ".np-config.json")) {
        return JSON.stringify(npConfig);
      }
      return "";
    });

    const result = await npAdapter.parse(
      [path.join(CWD, ".np-config.json")],
      CWD,
    );

    expect(result.unmappable).toHaveLength(0);
    const keys = result.unmappable.map((u) => u.key);
    expect(keys).not.toContain("yolo");
    expect(keys).not.toContain("preview");
  });

  it("handles minimal config with only branch", async () => {
    const npConfig = { branch: "release" };

    mockedReadFileSync.mockImplementation((p) => {
      if (p === path.join(CWD, ".np-config.json")) {
        return JSON.stringify(npConfig);
      }
      return "";
    });

    const result = await npAdapter.parse(
      [path.join(CWD, ".np-config.json")],
      CWD,
    );

    expect(result.source).toBe("np");
    expect(result.git?.branch).toBe("release");
    expect(result.npm).toBeUndefined();
    expect(result.tests).toBeUndefined();
    expect(result.github).toBeUndefined();
    expect(result.unmappable).toEqual([]);
  });

  it("prefers standalone config file over package.json when both provided", async () => {
    const standaloneConfig = { branch: "standalone-branch" };
    const pkgNpConfig = { branch: "pkg-branch" };

    mockedReadFileSync.mockImplementation((p) => {
      if (p === path.join(CWD, ".np-config.json")) {
        return JSON.stringify(standaloneConfig);
      }
      if (p === path.join(CWD, "package.json")) {
        return JSON.stringify({ name: "my-pkg", np: pkgNpConfig });
      }
      return "";
    });

    const result = await npAdapter.parse(
      [path.join(CWD, ".np-config.json"), path.join(CWD, "package.json")],
      CWD,
    );

    expect(result.git?.branch).toBe("standalone-branch");
  });

  it("returns empty result when no matching config file in files array", async () => {
    const result = await npAdapter.parse([], CWD);

    expect(result.source).toBe("np");
    expect(result.unmappable).toEqual([]);
    expect(result.git).toBeUndefined();
    expect(result.npm).toBeUndefined();
  });

  it("reads np key from package.json when package.json has no np config (uses empty config)", async () => {
    mockedReadFileSync.mockImplementation((p) => {
      if (p === path.join(CWD, "package.json")) {
        return JSON.stringify({ name: "my-pkg" });
      }
      return "";
    });

    const result = await npAdapter.parse([path.join(CWD, "package.json")], CWD);

    expect(result.source).toBe("np");
    expect(result.git).toBeUndefined();
    expect(result.npm).toBeUndefined();
  });

  it("maps cleanup=true to cleanInstall=true", async () => {
    const npConfig = { branch: "main", cleanup: true };

    mockedReadFileSync.mockImplementation((p) => {
      if (p === path.join(CWD, ".np-config.json")) {
        return JSON.stringify(npConfig);
      }
      return "";
    });

    const result = await npAdapter.parse(
      [path.join(CWD, ".np-config.json")],
      CWD,
    );

    expect(result.cleanInstall).toBe(true);
    expect(result.unmappable.map((u) => u.key)).not.toContain("cleanup");
  });

  it("maps cleanup=false to cleanInstall=false", async () => {
    const npConfig = { cleanup: false };

    mockedReadFileSync.mockImplementation((p) => {
      if (p === path.join(CWD, ".np-config.json")) {
        return JSON.stringify(npConfig);
      }
      return "";
    });

    const result = await npAdapter.parse(
      [path.join(CWD, ".np-config.json")],
      CWD,
    );

    expect(result.cleanInstall).toBe(false);
  });

  it("does not set cleanInstall when cleanup is absent", async () => {
    const npConfig = { branch: "main" };

    mockedReadFileSync.mockImplementation((p) => {
      if (p === path.join(CWD, ".np-config.json")) {
        return JSON.stringify(npConfig);
      }
      return "";
    });

    const result = await npAdapter.parse(
      [path.join(CWD, ".np-config.json")],
      CWD,
    );

    expect(result.cleanInstall).toBeUndefined();
  });

  it("maps anyBranch=true to anyBranch flag", async () => {
    const npConfig = { anyBranch: true };

    mockedReadFileSync.mockImplementation((p) => {
      if (p === path.join(CWD, ".np-config.json")) {
        return JSON.stringify(npConfig);
      }
      return "";
    });

    const result = await npAdapter.parse(
      [path.join(CWD, ".np-config.json")],
      CWD,
    );

    expect(result.anyBranch).toBe(true);
    expect(result.unmappable.map((u) => u.key)).not.toContain("anyBranch");
  });

  it("does not set anyBranch when anyBranch=false", async () => {
    const npConfig = { anyBranch: false };

    mockedReadFileSync.mockImplementation((p) => {
      if (p === path.join(CWD, ".np-config.json")) {
        return JSON.stringify(npConfig);
      }
      return "";
    });

    const result = await npAdapter.parse(
      [path.join(CWD, ".np-config.json")],
      CWD,
    );

    expect(result.anyBranch).toBeUndefined();
  });

  it("returns empty result when .np-config.js cannot be dynamically imported", async () => {
    // dynamic import() of a non-existent file will throw; we expect graceful fallback
    const result = await npAdapter.parse(
      [path.join(CWD, ".np-config.js")],
      CWD,
    );

    expect(result.source).toBe("np");
    expect(result.unmappable).toEqual([]);
    expect(result.git).toBeUndefined();
  });

  it("returns empty result when .np-config.cjs cannot be dynamically imported", async () => {
    const result = await npAdapter.parse(
      [path.join(CWD, ".np-config.cjs")],
      CWD,
    );

    expect(result.source).toBe("np");
    expect(result.unmappable).toEqual([]);
  });

  it("returns empty result when .np-config.mjs cannot be dynamically imported", async () => {
    const result = await npAdapter.parse(
      [path.join(CWD, ".np-config.mjs")],
      CWD,
    );

    expect(result.source).toBe("np");
    expect(result.unmappable).toEqual([]);
  });

  it("sets git when only commitMessage is set (no branch)", async () => {
    const npConfig = { message: "chore: release v%s" };

    mockedReadFileSync.mockImplementation((p) => {
      if (p === path.join(CWD, ".np-config.json")) {
        return JSON.stringify(npConfig);
      }
      return "";
    });

    const result = await npAdapter.parse(
      [path.join(CWD, ".np-config.json")],
      CWD,
    );

    expect(result.git?.commitMessage).toBe("chore: release v%s");
    expect(result.git?.branch).toBeUndefined();
  });
});

describe("npAdapter.getCleanupTargets()", () => {
  it("returns .np-config.json but excludes package.json", () => {
    const detected = {
      found: true,
      configFiles: [
        path.join(CWD, ".np-config.json"),
        path.join(CWD, "package.json"),
      ],
      relatedFiles: [],
    };

    const targets = npAdapter.getCleanupTargets(detected);

    expect(targets).toContain(path.join(CWD, ".np-config.json"));
    expect(targets).not.toContain(path.join(CWD, "package.json"));
  });

  it("returns empty array when only package.json detected", () => {
    const detected = {
      found: true,
      configFiles: [path.join(CWD, "package.json")],
      relatedFiles: [],
    };

    const targets = npAdapter.getCleanupTargets(detected);

    expect(targets).toHaveLength(0);
  });

  it("returns standalone config file when detected", () => {
    const detected = {
      found: true,
      configFiles: [path.join(CWD, ".np-config.json")],
      relatedFiles: [],
    };

    const targets = npAdapter.getCleanupTargets(detected);

    expect(targets).toEqual([path.join(CWD, ".np-config.json")]);
  });
});

describe("npAdapter.convert()", () => {
  it("returns empty config and no warnings", () => {
    const parsed = {
      source: "np" as const,
      unmappable: [],
    };

    const result = npAdapter.convert(parsed);

    expect(result.config).toEqual({});
    expect(result.warnings).toEqual([]);
  });
});
