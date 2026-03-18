import { describe, expect, it } from "vitest";
import {
  resolvePhases,
  validateOptions,
} from "../../../src/utils/resolve-phases.js";

describe("resolvePhases", () => {
  it("returns both phases for local mode without explicit phase", () => {
    expect(resolvePhases({})).toEqual(["prepare", "publish"]);
  });

  it("returns both phases for explicit local mode without phase", () => {
    expect(resolvePhases({ mode: "local" })).toEqual(["prepare", "publish"]);
  });

  it("returns prepare only when --prepare is set", () => {
    expect(resolvePhases({ prepare: true })).toEqual(["prepare"]);
  });

  it("returns publish only when --publish is set", () => {
    expect(resolvePhases({ publish: true })).toEqual(["publish"]);
  });

  it("throws when both --prepare and --publish are set", () => {
    expect(() => resolvePhases({ prepare: true, publish: true })).toThrow(
      "Cannot specify both --prepare and --publish",
    );
  });

  it("throws when ci mode has no phase", () => {
    expect(() => resolvePhases({ mode: "ci" })).toThrow(
      "CI mode requires --prepare or --publish",
    );
  });

  it("throws when --snapshot is used with ci mode", () => {
    expect(() =>
      resolvePhases({ mode: "ci", prepare: true, snapshot: true }),
    ).toThrow("Cannot use --snapshot with --mode ci");
  });

  it("returns prepare for ci mode with --prepare", () => {
    expect(resolvePhases({ mode: "ci", prepare: true })).toEqual(["prepare"]);
  });

  it("returns publish for ci mode with --publish", () => {
    expect(resolvePhases({ mode: "ci", publish: true })).toEqual(["publish"]);
  });
});

describe("validateOptions", () => {
  it("throws when both --prepare and --publish are set", () => {
    expect(() => validateOptions({ prepare: true, publish: true })).toThrow(
      "Cannot specify both --prepare and --publish",
    );
  });

  it("throws when ci mode has no phase", () => {
    expect(() => validateOptions({ mode: "ci" })).toThrow(
      "CI mode requires --prepare or --publish",
    );
  });

  it("throws when --snapshot is used with ci mode", () => {
    expect(() =>
      validateOptions({ mode: "ci", prepare: true, snapshot: true }),
    ).toThrow("Cannot use --snapshot with --mode ci");
  });

  it("allows local mode with snapshot", () => {
    expect(() => validateOptions({ snapshot: true })).not.toThrow();
  });

  it("allows local mode without any phase", () => {
    expect(() => validateOptions({})).not.toThrow();
  });
});
