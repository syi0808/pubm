import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveConfig } from "../../../src/config/index.js";
import type { ResolvedPackageConfig } from "../../../src/config/types.js";
import { inspectPackages } from "../../../src/inspect.js";

const roots: string[] = [];

function makeRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), "pubm-discovery-contract-"));
  roots.push(root);
  return root;
}

function writeFixture(root: string, relativePath: string, contents: string) {
  const target = path.join(root, relativePath);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, contents, "utf-8");
}

function writePackageJson(
  root: string,
  packagePath: string,
  contents: Record<string, unknown>,
) {
  writeFixture(
    root,
    path.join(packagePath, "package.json"),
    `${JSON.stringify(contents, null, 2)}\n`,
  );
}

function writeCargoToml(
  root: string,
  packagePath: string,
  {
    name,
    version,
    publish,
    dependencies = [],
  }: {
    name: string;
    version: string;
    publish?: false;
    dependencies?: string[];
  },
) {
  const dependencyLines =
    dependencies.length > 0
      ? ["", "[dependencies]", ...dependencies.map((dep) => `${dep} = "1"`)]
      : [];
  writeFixture(
    root,
    path.join(packagePath, "Cargo.toml"),
    [
      "[package]",
      `name = "${name}"`,
      `version = "${version}"`,
      'edition = "2021"',
      ...(publish === false ? ["publish = false"] : []),
      ...dependencyLines,
      "",
    ].join("\n"),
  );
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}

function packageSummary(packages: ResolvedPackageConfig[]) {
  return packages
    .map((pkg) => ({
      name: pkg.name,
      version: pkg.version,
      path: normalizePath(pkg.path),
      ecosystem: pkg.ecosystem,
      registries: pkg.registries,
      dependencies: pkg.dependencies,
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("discovery/config/inspect contracts", () => {
  it("resolves a single JavaScript package from the current directory", async () => {
    const root = makeRoot();
    writePackageJson(root, ".", {
      name: "single-js",
      version: "1.2.3",
      dependencies: {
        "left-pad": "^1.3.0",
      },
    });

    const config = await resolveConfig({}, root);

    expect(config.discoveryEmpty).toBeUndefined();
    expect(config.versioning).toBe("independent");
    expect(packageSummary(config.packages)).toEqual([
      {
        name: "single-js",
        version: "1.2.3",
        path: ".",
        ecosystem: "js",
        registries: ["npm"],
        dependencies: ["left-pad"],
      },
    ]);
  });

  it("resolves a single Rust package from the current directory", async () => {
    const root = makeRoot();
    writeCargoToml(root, ".", {
      name: "single-rust",
      version: "0.4.0",
      dependencies: ["serde"],
    });

    const config = await resolveConfig({}, root);

    expect(packageSummary(config.packages)).toEqual([
      {
        name: "single-rust",
        version: "0.4.0",
        path: ".",
        ecosystem: "rust",
        registries: ["crates"],
        dependencies: ["serde"],
      },
    ]);
  });

  it("resolves mixed JavaScript and Rust packages from explicit config package entries", async () => {
    const root = makeRoot();
    writePackageJson(root, "js-app", {
      name: "@scope/js-app",
      version: "2.0.0",
    });
    writeCargoToml(root, "rust-crate", {
      name: "rust_crate",
      version: "0.8.0",
    });

    const config = await resolveConfig(
      {
        packages: [{ path: "js-app" }, { path: "rust-crate" }],
      },
      root,
    );

    expect(packageSummary(config.packages)).toEqual([
      {
        name: "@scope/js-app",
        version: "2.0.0",
        path: "js-app",
        ecosystem: "js",
        registries: ["npm"],
        dependencies: [],
      },
      {
        name: "rust_crate",
        version: "0.8.0",
        path: "rust-crate",
        ecosystem: "rust",
        registries: ["crates"],
        dependencies: [],
      },
    ]);
  });

  it("discovers publishable packages from workspace patterns", async () => {
    const root = makeRoot();
    writeFixture(root, "pnpm-workspace.yaml", 'packages:\n  - "packages/*"\n');
    writePackageJson(root, "packages/core", {
      name: "@scope/core",
      version: "1.0.0",
    });
    writePackageJson(root, "packages/cli", {
      name: "@scope/cli",
      version: "1.0.1",
      dependencies: {
        "@scope/core": "workspace:*",
      },
    });

    const config = await resolveConfig({}, root);

    expect(packageSummary(config.packages)).toEqual([
      {
        name: "@scope/cli",
        version: "1.0.1",
        path: "packages/cli",
        ecosystem: "js",
        registries: ["npm"],
        dependencies: ["@scope/core"],
      },
      {
        name: "@scope/core",
        version: "1.0.0",
        path: "packages/core",
        ecosystem: "js",
        registries: ["npm"],
        dependencies: [],
      },
    ]);
  });

  it("applies ignore patterns and filters private packages during config resolution", async () => {
    const root = makeRoot();
    writeFixture(root, "pnpm-workspace.yaml", 'packages:\n  - "packages/*"\n');
    writePackageJson(root, "packages/public", {
      name: "@scope/public",
      version: "1.0.0",
    });
    writePackageJson(root, "packages/ignored", {
      name: "@scope/ignored",
      version: "1.0.0",
    });
    writePackageJson(root, "packages/private-js", {
      name: "@scope/private-js",
      version: "1.0.0",
      private: true,
    });
    writeCargoToml(root, "packages/private-rust", {
      name: "private_rust",
      version: "1.0.0",
      publish: false,
    });

    const config = await resolveConfig({ ignore: ["packages/ignored"] }, root);

    expect(packageSummary(config.packages)).toEqual([
      {
        name: "@scope/public",
        version: "1.0.0",
        path: "packages/public",
        ecosystem: "js",
        registries: ["npm"],
        dependencies: [],
      },
    ]);
  });

  it("marks config discovery as empty when no publishable package exists", async () => {
    const root = makeRoot();
    writeFixture(root, "README.md", "# empty fixture\n");

    const config = await resolveConfig({}, root);

    expect(config.packages).toEqual([]);
    expect(config.discoveryEmpty).toBe(true);
  });

  it("returns a JSON-serializable inspect shape for a mixed workspace", async () => {
    const root = makeRoot();
    writeFixture(
      root,
      "pnpm-workspace.yaml",
      ["packages:", '  - "packages/*"', '  - "crates/*"', ""].join("\n"),
    );
    writePackageJson(root, "packages/js", {
      name: "@scope/inspect-js",
      version: "1.3.0",
    });
    writeCargoToml(root, "crates/rust", {
      name: "inspect_rust",
      version: "0.2.0",
    });

    const config = await resolveConfig(
      {
        packages: [{ path: "packages/js" }, { path: "crates/rust" }],
      },
      root,
    );
    const inspectResult = JSON.parse(
      JSON.stringify(inspectPackages(config, root)),
    );

    expect(inspectResult).toEqual({
      ecosystem: "JavaScript, Rust",
      workspace: { type: "pnpm", monorepo: true },
      packages: [
        {
          name: "@scope/inspect-js",
          version: "1.3.0",
          path: "packages/js",
          registries: ["npm"],
        },
        {
          name: "inspect_rust",
          version: "0.2.0",
          path: "crates/rust",
          registries: ["crates"],
        },
      ],
    });
  });
});
