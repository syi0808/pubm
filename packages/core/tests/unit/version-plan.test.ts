import { describe, expect, it } from "vitest";
import type { VersionPlan } from "../../src/context.js";
import { resolveVersion } from "../../src/context.js";

describe("resolveVersion", () => {
  it("returns version for single mode", () => {
    const plan: VersionPlan = {
      mode: "single",
      version: "1.0.0",
      packagePath: "packages/my-pkg",
    };
    expect(resolveVersion(plan)).toBe("1.0.0");
  });

  it("returns version for fixed mode", () => {
    const plan: VersionPlan = {
      mode: "fixed",
      version: "2.0.0",
      packages: new Map([
        ["packages/a", "2.0.0"],
        ["packages/b", "2.0.0"],
      ]),
    };
    expect(resolveVersion(plan)).toBe("2.0.0");
  });

  it("returns picker result for independent mode", () => {
    const plan: VersionPlan = {
      mode: "independent",
      packages: new Map([
        ["packages/core", "1.0.0"],
        ["packages/cli", "2.0.0"],
      ]),
    };
    expect(resolveVersion(plan, (pkgs) => pkgs.get("packages/core")!)).toBe(
      "1.0.0",
    );
  });

  it("throws when independent mode has no picker", () => {
    const plan: VersionPlan = {
      mode: "independent",
      packages: new Map([["packages/a", "1.0.0"]]),
    };
    expect(() => resolveVersion(plan)).toThrow(
      "independent mode requires an explicit version picker",
    );
  });

  it("ignores picker for single mode", () => {
    const plan: VersionPlan = {
      mode: "single",
      version: "1.0.0",
      packagePath: "packages/my-pkg",
    };
    expect(resolveVersion(plan, () => "9.9.9")).toBe("1.0.0");
  });

  it("ignores picker for fixed mode", () => {
    const plan: VersionPlan = {
      mode: "fixed",
      version: "2.0.0",
      packages: new Map([["packages/a", "2.0.0"]]),
    };
    expect(resolveVersion(plan, () => "9.9.9")).toBe("2.0.0");
  });
});
