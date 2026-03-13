import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

vi.mock("yaml", () => ({
  parse: vi.fn(),
}));

vi.mock("smol-toml", () => ({
  parse: vi.fn(),
}));

vi.mock("jsonc-parser", () => ({
  parse: vi.fn(),
}));

import { existsSync, readFileSync } from "node:fs";
import { parse as parseJsonc } from "jsonc-parser";
import { parse as parseToml } from "smol-toml";
import { parse } from "yaml";
import { detectWorkspace } from "../../../src/monorepo/workspace.js";

const mockedExistsSync = vi.mocked(existsSync);
const mockedReadFileSync = vi.mocked(readFileSync);
const mockedYamlParse = vi.mocked(parse);
const mockedParseToml = vi.mocked(parseToml);
const mockedParseJsonc = vi.mocked(parseJsonc);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("detectWorkspace", () => {
  it("returns empty array when no workspace config is found", () => {
    mockedExistsSync.mockReturnValue(false);

    const result = detectWorkspace("/project");

    expect(result).toEqual([]);
  });

  it("detects pnpm workspace from pnpm-workspace.yaml", () => {
    mockedExistsSync.mockImplementation((path) =>
      String(path).endsWith("pnpm-workspace.yaml"),
    );
    mockedReadFileSync.mockReturnValue("packages:\n  - packages/*\n");
    mockedYamlParse.mockReturnValue({ packages: ["packages/*"] });

    const result = detectWorkspace("/project");

    expect(result).toEqual([
      {
        type: "pnpm",
        patterns: ["packages/*"],
      },
    ]);
  });

  it("detects npm/yarn workspace from package.json workspaces array", () => {
    mockedExistsSync.mockImplementation(
      (path) =>
        !String(path).endsWith("pnpm-workspace.yaml") &&
        String(path).endsWith("package.json"),
    );
    mockedReadFileSync.mockReturnValue(
      JSON.stringify({ workspaces: ["packages/*", "apps/*"] }),
    );

    const result = detectWorkspace("/project");

    expect(result).toEqual([
      {
        type: "npm",
        patterns: ["packages/*", "apps/*"],
      },
    ]);
  });

  it("handles yarn workspaces object format { packages: [...] }", () => {
    mockedExistsSync.mockImplementation(
      (path) =>
        !String(path).endsWith("pnpm-workspace.yaml") &&
        String(path).endsWith("package.json"),
    );
    mockedReadFileSync.mockReturnValue(
      JSON.stringify({
        workspaces: { packages: ["packages/*", "modules/*"] },
      }),
    );

    const result = detectWorkspace("/project");

    expect(result).toEqual([
      {
        type: "yarn",
        patterns: ["packages/*", "modules/*"],
      },
    ]);
  });

  it("skips JS workspace detection when pnpm-workspace.yaml is found", () => {
    mockedExistsSync.mockImplementation(
      (p) =>
        String(p).endsWith("pnpm-workspace.yaml") ||
        String(p).endsWith("package.json"),
    );
    mockedReadFileSync.mockImplementation((p) => {
      if (String(p).endsWith("pnpm-workspace.yaml"))
        return "packages:\n  - libs/*\n";
      return JSON.stringify({ workspaces: ["packages/*"] });
    });
    mockedYamlParse.mockReturnValue({ packages: ["libs/*"] });

    const result = detectWorkspace("/project");

    expect(result).toEqual([{ type: "pnpm", patterns: ["libs/*"] }]);
    expect(result.some((w) => w.type === "npm" || w.type === "bun")).toBe(
      false,
    );
  });

  it("returns empty patterns when pnpm-workspace.yaml has no packages field", () => {
    mockedExistsSync.mockImplementation((path) =>
      String(path).endsWith("pnpm-workspace.yaml"),
    );
    mockedReadFileSync.mockReturnValue("");
    mockedYamlParse.mockReturnValue(null);

    const result = detectWorkspace("/project");

    expect(result).toEqual([
      {
        type: "pnpm",
        patterns: [],
      },
    ]);
  });

  it("returns empty array when package.json has no workspaces field", () => {
    mockedExistsSync.mockImplementation(
      (path) =>
        !String(path).endsWith("pnpm-workspace.yaml") &&
        String(path).endsWith("package.json"),
    );
    mockedReadFileSync.mockReturnValue(JSON.stringify({ name: "my-app" }));

    const result = detectWorkspace("/project");

    expect(result).toEqual([]);
  });

  it("uses process.cwd() when no cwd is provided", () => {
    mockedExistsSync.mockReturnValue(false);

    detectWorkspace();

    expect(mockedExistsSync).toHaveBeenCalled();
  });

  it("detects Cargo.toml workspace members", () => {
    mockedExistsSync.mockImplementation((path) =>
      String(path).endsWith("Cargo.toml"),
    );
    mockedReadFileSync.mockReturnValue("");
    mockedParseToml.mockReturnValue({
      workspace: { members: ["crates/*", "tools/*"] },
    });

    const result = detectWorkspace("/project");

    expect(result).toEqual([
      {
        type: "cargo",
        patterns: ["crates/*", "tools/*"],
      },
    ]);
  });

  it("detects Cargo.toml workspace with exclude", () => {
    mockedExistsSync.mockImplementation((path) =>
      String(path).endsWith("Cargo.toml"),
    );
    mockedReadFileSync.mockReturnValue("");
    mockedParseToml.mockReturnValue({
      workspace: {
        members: ["crates/*"],
        exclude: ["crates/experimental"],
      },
    });

    const result = detectWorkspace("/project");

    expect(result).toEqual([
      {
        type: "cargo",
        patterns: ["crates/*"],
        exclude: ["crates/experimental"],
      },
    ]);
  });

  it("ignores Cargo.toml without workspace.members", () => {
    mockedExistsSync.mockImplementation((path) =>
      String(path).endsWith("Cargo.toml"),
    );
    mockedReadFileSync.mockReturnValue("");
    mockedParseToml.mockReturnValue({
      package: { name: "my-crate" },
    });

    const result = detectWorkspace("/project");

    expect(result).toEqual([]);
  });

  it("detects deno.json workspace", () => {
    mockedExistsSync.mockImplementation((path) =>
      String(path).endsWith("deno.json"),
    );
    mockedReadFileSync.mockReturnValue(
      JSON.stringify({ workspace: ["./packages/core", "packages/cli"] }),
    );

    const result = detectWorkspace("/project");

    expect(result).toEqual([
      {
        type: "deno",
        patterns: ["packages/core", "packages/cli"],
      },
    ]);
  });

  it("detects deno.jsonc workspace using jsonc-parser", () => {
    mockedExistsSync.mockImplementation((path) =>
      String(path).endsWith("deno.jsonc"),
    );
    mockedReadFileSync.mockReturnValue("");
    mockedParseJsonc.mockReturnValue({
      workspace: ["./libs/shared"],
    });

    const result = detectWorkspace("/project");

    expect(result).toEqual([
      {
        type: "deno",
        patterns: ["libs/shared"],
      },
    ]);
  });

  it("detects bun workspace when bunfig.toml exists", () => {
    mockedExistsSync.mockImplementation(
      (path) =>
        String(path).endsWith("package.json") ||
        String(path).endsWith("bunfig.toml"),
    );
    mockedReadFileSync.mockReturnValue(
      JSON.stringify({ workspaces: ["packages/*"] }),
    );

    const result = detectWorkspace("/project");

    expect(result).toEqual([
      {
        type: "bun",
        patterns: ["packages/*"],
      },
    ]);
  });

  it("detects multiple workspaces in polyglot monorepo", () => {
    mockedExistsSync.mockImplementation(
      (path) =>
        String(path).endsWith("pnpm-workspace.yaml") ||
        String(path).endsWith("Cargo.toml"),
    );
    mockedReadFileSync.mockImplementation((p) => {
      if (String(p).endsWith("pnpm-workspace.yaml"))
        return "packages:\n  - packages/*\n";
      return "";
    });
    mockedYamlParse.mockReturnValue({ packages: ["packages/*"] });
    mockedParseToml.mockReturnValue({
      workspace: { members: ["crates/*"] },
    });

    const result = detectWorkspace("/project");

    expect(result).toEqual([
      { type: "pnpm", patterns: ["packages/*"] },
      { type: "cargo", patterns: ["crates/*"] },
    ]);
  });
});
