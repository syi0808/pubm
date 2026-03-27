import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/monorepo/workspace.js", () => ({
  detectWorkspace: vi.fn(),
}));

import type { ResolvedPubmConfig } from "../../src/config/types.js";
import { inspectPackages } from "../../src/inspect.js";
import { detectWorkspace } from "../../src/monorepo/workspace.js";

const mockedDetectWorkspace = vi.mocked(detectWorkspace);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("inspectPackages", () => {
  it("returns single JS package with no workspace", () => {
    mockedDetectWorkspace.mockReturnValue([]);

    const config = {
      packages: [
        {
          name: "my-package",
          version: "1.0.0",
          path: ".",
          registries: ["npm"],
          dependencies: [],
        },
      ],
    } as unknown as ResolvedPubmConfig;

    const result = inspectPackages(config, "/project");

    expect(result).toEqual({
      ecosystem: "JavaScript",
      workspace: { type: "single", monorepo: false },
      packages: [
        {
          name: "my-package",
          version: "1.0.0",
          path: ".",
          registries: ["npm"],
        },
      ],
    });
  });

  it("returns monorepo with pnpm workspace", () => {
    mockedDetectWorkspace.mockReturnValue([
      { type: "pnpm", patterns: ["packages/*"] },
    ]);

    const config = {
      packages: [
        {
          name: "@pubm/core",
          version: "1.0.0",
          path: "packages/core",
          registries: ["npm", "jsr"],
          dependencies: [],
        },
        {
          name: "pubm",
          version: "1.0.0",
          path: "packages/pubm",
          registries: ["npm"],
          dependencies: ["@pubm/core"],
        },
      ],
    } as unknown as ResolvedPubmConfig;

    const result = inspectPackages(config, "/project");

    expect(result).toEqual({
      ecosystem: "JavaScript",
      workspace: { type: "pnpm", monorepo: true },
      packages: [
        {
          name: "@pubm/core",
          version: "1.0.0",
          path: "packages/core",
          registries: ["npm", "jsr"],
        },
        {
          name: "pubm",
          version: "1.0.0",
          path: "packages/pubm",
          registries: ["npm"],
        },
      ],
    });
  });

  it("returns rust ecosystem for crates registry", () => {
    mockedDetectWorkspace.mockReturnValue([]);

    const config = {
      packages: [
        {
          name: "my-crate",
          version: "0.1.0",
          path: ".",
          registries: ["crates"],
          dependencies: [],
        },
      ],
    } as unknown as ResolvedPubmConfig;

    const result = inspectPackages(config, "/project");

    expect(result.ecosystem).toBe("Rust");
  });

  it("returns mixed ecosystem when both JS and Rust packages exist", () => {
    mockedDetectWorkspace.mockReturnValue([]);

    const config = {
      packages: [
        {
          name: "my-pkg",
          version: "1.0.0",
          path: "js",
          registries: ["npm"],
          dependencies: [],
        },
        {
          name: "my-crate",
          version: "0.1.0",
          path: "rust",
          registries: ["crates"],
          dependencies: [],
        },
      ],
    } as unknown as ResolvedPubmConfig;

    const result = inspectPackages(config, "/project");

    expect(result.ecosystem).toBe("JavaScript, Rust");
  });

  it("returns empty packages when discoveryEmpty is true", () => {
    mockedDetectWorkspace.mockReturnValue([]);

    const config = {
      packages: [],
      discoveryEmpty: true,
    } as unknown as ResolvedPubmConfig;

    const result = inspectPackages(config, "/project");

    expect(result.packages).toEqual([]);
  });

  it("preserves custom registry URLs in registries", () => {
    mockedDetectWorkspace.mockReturnValue([]);

    const config = {
      packages: [
        {
          name: "my-pkg",
          version: "1.0.0",
          path: ".",
          registries: ["npm", "https://registry.example.com"],
          dependencies: [],
        },
      ],
    } as unknown as ResolvedPubmConfig;

    const result = inspectPackages(config, "/project");

    expect(result.packages[0].registries).toEqual([
      "npm",
      "https://registry.example.com",
    ]);
  });

  it("returns unknown ecosystem for custom-only registry", () => {
    mockedDetectWorkspace.mockReturnValue([]);

    const config = {
      packages: [
        {
          name: "my-pkg",
          version: "1.0.0",
          path: ".",
          registries: ["https://registry.example.com"],
          dependencies: [],
        },
      ],
    } as unknown as ResolvedPubmConfig;

    const result = inspectPackages(config, "/project");

    expect(result.ecosystem).toBe("unknown");
  });

  it("uses first workspace type when multiple detected", () => {
    mockedDetectWorkspace.mockReturnValue([
      { type: "pnpm", patterns: ["packages/*"] },
      { type: "cargo", patterns: ["crates/*"] },
    ]);

    const config = {
      packages: [
        {
          name: "my-pkg",
          version: "1.0.0",
          path: "packages/core",
          registries: ["npm"],
          dependencies: [],
        },
      ],
    } as unknown as ResolvedPubmConfig;

    const result = inspectPackages(config, "/project");

    expect(result.workspace.type).toBe("pnpm");
  });

  it("returns 'unknown' for unregistered registry types", () => {
    mockedDetectWorkspace.mockReturnValue([]);

    const config = {
      packages: [
        {
          name: "my-pkg",
          version: "1.0.0",
          path: ".",
          registries: ["totally-unknown-registry"],
          dependencies: [],
        },
      ],
    } as unknown as ResolvedPubmConfig;

    const result = inspectPackages(config, "/project");
    expect(result.ecosystem).toBe("unknown");
  });

  it("detects monorepo even with single package in workspace", () => {
    mockedDetectWorkspace.mockReturnValue([
      { type: "pnpm", patterns: ["packages/*"] },
    ]);

    const config = {
      packages: [
        {
          name: "only-pkg",
          version: "1.0.0",
          path: "packages/only",
          registries: ["npm"],
          dependencies: [],
        },
      ],
    } as unknown as ResolvedPubmConfig;

    const result = inspectPackages(config, "/project");

    expect(result.workspace.monorepo).toBe(true);
  });
});
