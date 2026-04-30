import { describe, expect, it } from "vitest";
import {
  resolvePhases,
  validateOptions,
} from "../../../src/utils/resolve-phases.js";

describe("resolvePhases", () => {
  it("returns both phases without explicit phase", () => {
    expect(resolvePhases({})).toEqual(["prepare", "publish"]);
  });

  it("returns prepare only when phase is prepare", () => {
    expect(resolvePhases({ phase: "prepare" })).toEqual(["prepare"]);
  });

  it("returns publish only when phase is publish", () => {
    expect(resolvePhases({ phase: "publish" })).toEqual(["publish"]);
  });

  it("throws for invalid phases", () => {
    expect(() => resolvePhases({ phase: "invalid" as "prepare" })).toThrow(
      'Invalid release phase "invalid". Use "prepare" or "publish".',
    );
  });
});

describe("validateOptions", () => {
  it("throws for invalid phases", () => {
    expect(() => validateOptions({ phase: "invalid" as "prepare" })).toThrow(
      'Invalid release phase "invalid". Use "prepare" or "publish".',
    );
  });

  it("allows options without any phase", () => {
    expect(() => validateOptions({})).not.toThrow();
  });

  it("allows known phases", () => {
    expect(() => validateOptions({ phase: "prepare" })).not.toThrow();
    expect(() => validateOptions({ phase: "publish" })).not.toThrow();
  });
});
