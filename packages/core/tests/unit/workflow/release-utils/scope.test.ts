import { describe, expect, it } from "vitest";
import type { PubmContext, VersionPlan } from "../../../../src/context.js";
import { buildReleasePrScopes } from "../../../../src/workflow/release-utils/scope.js";

const packages = [
  {
    ecosystem: "js" as const,
    name: "@acme/a",
    path: "packages/a",
    registries: ["npm" as const],
    version: "1.0.0",
    dependencies: [],
  },
  {
    ecosystem: "js" as const,
    name: "@acme/b",
    path: "packages/b",
    registries: ["npm" as const],
    version: "1.0.0",
    dependencies: [],
  },
  {
    ecosystem: "rust" as const,
    name: "crate-c",
    path: "crates/c",
    registries: ["crates" as const],
    version: "1.0.0",
    dependencies: [],
  },
];

function ctx(overrides: Record<string, unknown> = {}): PubmContext {
  return {
    config: {
      packages,
      versioning: "independent",
      fixed: [],
      linked: [],
      ...(overrides as object),
    },
  } as PubmContext;
}

describe("buildReleasePrScopes", () => {
  it("keeps single plans package-scoped when they include a package key in a multi-package config", () => {
    const plan: VersionPlan = {
      mode: "single",
      packageKey: "packages/a::js",
      version: "1.1.0",
    };

    expect(buildReleasePrScopes(ctx(), plan)).toEqual([
      {
        id: "single",
        kind: "single",
        packageKeys: ["packages/a::js"],
        displayName: "release",
        slug: "release",
      },
    ]);
  });

  it("groups fixed plans into one fixed scope", () => {
    const plan: VersionPlan = {
      mode: "fixed",
      version: "2.0.0",
      packages: new Map([
        ["packages/a::js", "2.0.0"],
        ["packages/b::js", "2.0.0"],
      ]),
    };

    const scopes = buildReleasePrScopes(ctx({ versioning: "fixed" }), plan);

    expect(scopes).toHaveLength(1);
    expect(scopes[0]).toMatchObject({
      id: "fixed",
      kind: "fixed",
      packageKeys: ["packages/a::js", "packages/b::js"],
    });
  });

  it("uses package scopes for independent grouping override", () => {
    const plan: VersionPlan = {
      mode: "independent",
      packages: new Map([
        ["packages/a::js", "1.1.0"],
        ["crates/c::rust", "1.1.0"],
      ]),
    };

    const scopes = buildReleasePrScopes(
      ctx({ releasePr: { grouping: "independent" } }),
      plan,
    );

    expect(scopes.map((scope) => [scope.kind, scope.displayName])).toEqual([
      ["package", "@acme/a"],
      ["package", "crate-c"],
    ]);
  });

  it("inherits fixed and linked groups from top-level config", () => {
    const plan: VersionPlan = {
      mode: "independent",
      packages: new Map([
        ["packages/a::js", "1.1.0"],
        ["packages/b::js", "1.1.0"],
        ["crates/c::rust", "1.1.0"],
      ]),
    };

    const scopes = buildReleasePrScopes(
      ctx({
        fixed: [["@acme/a", "@acme/b"]],
        linked: [["packages/b", "crate-c"]],
      }),
      plan,
    );

    expect(scopes.map((scope) => scope.kind)).toEqual(["fixed", "group"]);
    expect(scopes[0].packageKeys).toEqual(["packages/a::js", "packages/b::js"]);
    expect(scopes[1].packageKeys).toEqual(["crates/c::rust"]);
  });

  it("matches configured group globs against package names, paths, and keys", () => {
    const plan: VersionPlan = {
      mode: "independent",
      packages: new Map([
        ["packages/a::js", "1.1.0"],
        ["packages/b::js", "1.1.0"],
        ["crates/c::rust", "1.1.0"],
      ]),
    };

    const scopes = buildReleasePrScopes(
      ctx({
        fixed: [["@acme/*"]],
        linked: [["crates/*"]],
      }),
      plan,
    );

    expect(scopes.map((scope) => scope.kind)).toEqual(["fixed", "group"]);
    expect(scopes[0].packageKeys).toEqual(["packages/a::js", "packages/b::js"]);
    expect(scopes[1].packageKeys).toEqual(["crates/c::rust"]);
  });

  it("can force one fixed scope for independent plans", () => {
    const plan: VersionPlan = {
      mode: "independent",
      packages: new Map([
        ["packages/a::js", "1.1.0"],
        ["packages/b::js", "1.1.0"],
      ]),
    };

    expect(
      buildReleasePrScopes(ctx({ releasePr: { grouping: "fixed" } }), plan)[0],
    ).toMatchObject({
      kind: "fixed",
      packageKeys: ["packages/a::js", "packages/b::js"],
    });
  });

  it("uses releasePr fixed and linked groups instead of top-level groups", () => {
    const plan: VersionPlan = {
      mode: "independent",
      packages: new Map([
        ["packages/a::js", "1.1.0"],
        ["packages/b::js", "1.1.0"],
        ["crates/c::rust", "1.1.0"],
      ]),
    };

    const scopes = buildReleasePrScopes(
      ctx({
        fixed: [["packages/a", "packages/b"]],
        linked: [["crates/c"]],
        releasePr: {
          grouping: "independent",
          fixed: [],
          linked: [["packages/b", "crates/c"]],
        },
      }),
      plan,
    );

    expect(scopes.map((scope) => scope.kind)).toEqual(["group", "package"]);
    expect(scopes[0].packageKeys).toEqual(["crates/c::rust", "packages/b::js"]);
    expect(scopes[1].packageKeys).toEqual(["packages/a::js"]);
  });

  it("skips configured groups that do not contain pending packages", () => {
    const plan: VersionPlan = {
      mode: "independent",
      packages: new Map([["packages/a::js", "1.1.0"]]),
    };

    expect(
      buildReleasePrScopes(
        ctx({
          fixed: [["packages/missing"]],
          linked: [["crates/c"]],
        }),
        plan,
      ),
    ).toEqual([
      {
        id: "packages/a::js",
        kind: "package",
        packageKeys: ["packages/a::js"],
        displayName: "@acme/a",
        slug: "packages-a-js",
      },
    ]);
  });

  it("does not duplicate packages already claimed by a previous group", () => {
    const plan: VersionPlan = {
      mode: "independent",
      packages: new Map([["packages/a::js", "1.1.0"]]),
    };

    expect(
      buildReleasePrScopes(
        ctx({
          fixed: [["@acme/a"], ["packages/a"]],
          linked: [["packages/a"]],
        }),
        plan,
      ),
    ).toEqual([
      {
        id: "fixed:packages/a::js",
        kind: "fixed",
        packageKeys: ["packages/a::js"],
        displayName: "@acme/a",
        slug: "acme-a",
      },
    ]);
  });

  it("falls back to all packages for unknown single-plan package keys", () => {
    const plan: VersionPlan = {
      mode: "single",
      packageKey: "missing::js",
      version: "1.1.0",
    };

    expect(buildReleasePrScopes(ctx(), plan)[0]).toMatchObject({
      id: "single",
      kind: "single",
      packageKeys: ["crates/c::rust", "packages/a::js", "packages/b::js"],
    });
  });

  it("uses the package key as display name when package metadata is missing", () => {
    const plan: VersionPlan = {
      mode: "independent",
      packages: new Map([["missing::js", "1.1.0"]]),
    };

    expect(buildReleasePrScopes(ctx(), plan)).toEqual([
      {
        id: "missing::js",
        kind: "package",
        packageKeys: ["missing::js"],
        displayName: "missing::js",
        slug: "missing-js",
      },
    ]);
  });
});
