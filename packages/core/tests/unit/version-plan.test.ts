import { describe, expect, it } from "vitest";
import type { PubmContext, VersionPlan } from "../../src/context.js";
import { getPackageVersion, resolveVersion } from "../../src/context.js";

describe("resolveVersion", () => {
  it("returns version for single mode", () => {
    const plan: VersionPlan = {
      mode: "single",
      version: "1.0.0",
      packageKey: "packages/my-pkg::js",
    };
    expect(resolveVersion(plan)).toBe("1.0.0");
  });

  it("returns version for fixed mode", () => {
    const plan: VersionPlan = {
      mode: "fixed",
      version: "2.0.0",
      packages: new Map([
        ["packages/a::js", "2.0.0"],
        ["packages/b::js", "2.0.0"],
      ]),
    };
    expect(resolveVersion(plan)).toBe("2.0.0");
  });

  it("returns picker result for independent mode", () => {
    const plan: VersionPlan = {
      mode: "independent",
      packages: new Map([
        ["packages/core::js", "1.0.0"],
        ["packages/cli::js", "2.0.0"],
      ]),
    };
    expect(resolveVersion(plan, (pkgs) => pkgs.get("packages/core::js")!)).toBe(
      "1.0.0",
    );
  });

  it("throws when independent mode has no picker", () => {
    const plan: VersionPlan = {
      mode: "independent",
      packages: new Map([["packages/a::js", "1.0.0"]]),
    };
    expect(() => resolveVersion(plan)).toThrow(
      "independent mode requires an explicit version picker",
    );
  });

  it("ignores picker for single mode", () => {
    const plan: VersionPlan = {
      mode: "single",
      version: "1.0.0",
      packageKey: "packages/my-pkg::js",
    };
    expect(resolveVersion(plan, () => "9.9.9")).toBe("1.0.0");
  });

  it("ignores picker for fixed mode", () => {
    const plan: VersionPlan = {
      mode: "fixed",
      version: "2.0.0",
      packages: new Map([["packages/a::js", "2.0.0"]]),
    };
    expect(resolveVersion(plan, () => "9.9.9")).toBe("2.0.0");
  });
});

describe("getPackageVersion", () => {
  function makeCtx(plan?: VersionPlan): PubmContext {
    return {
      config: {} as PubmContext["config"],
      options: {} as PubmContext["options"],
      cwd: "/tmp",
      runtime: {
        tag: "latest",
        promptEnabled: false,
        cleanWorkingTree: false,
        pluginRunner: { run: async () => {} } as unknown as PubmContext["runtime"]["pluginRunner"],
        rollback: { add: () => {} } as unknown as PubmContext["runtime"]["rollback"],
        versionPlan: plan,
      },
    } as unknown as PubmContext;
  }

  it("returns version for packageKey in independent mode", () => {
    const plan: VersionPlan = {
      mode: "independent",
      packages: new Map([
        ["pkg-a::js", "1.2.3"],
        ["pkg-b::rust", "4.5.6"],
      ]),
    };
    const ctx = makeCtx(plan);
    expect(getPackageVersion(ctx, "pkg-a::js")).toBe("1.2.3");
    expect(getPackageVersion(ctx, "pkg-b::rust")).toBe("4.5.6");
    expect(getPackageVersion(ctx, "pkg-c::js")).toBe("");
  });

  it("returns version for single mode regardless of key", () => {
    const plan: VersionPlan = {
      mode: "single",
      version: "3.0.0",
      packageKey: "pkg-a::js",
    };
    const ctx = makeCtx(plan);
    expect(getPackageVersion(ctx, "pkg-a::js")).toBe("3.0.0");
    expect(getPackageVersion(ctx, "any-other-key")).toBe("3.0.0");
  });

  it("returns version for fixed mode regardless of key", () => {
    const plan: VersionPlan = {
      mode: "fixed",
      version: "5.0.0",
      packages: new Map([["pkg-a::js", "5.0.0"]]),
    };
    const ctx = makeCtx(plan);
    expect(getPackageVersion(ctx, "pkg-a::js")).toBe("5.0.0");
    expect(getPackageVersion(ctx, "any-other-key")).toBe("5.0.0");
  });

  it("returns empty string when no version plan", () => {
    const ctx = makeCtx(undefined);
    expect(getPackageVersion(ctx, "pkg-a::js")).toBe("");
  });
});
