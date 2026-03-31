import { describe, expect, it } from "vitest";
import { parseConventionalCommit } from "../../../src/conventional-commit/parser.js";

describe("parseConventionalCommit", () => {
  it("parses basic feat commit", () => {
    const result = parseConventionalCommit("abc1234", "feat: add login");
    expect(result).toEqual({
      hash: "abc1234",
      type: "feat",
      scope: undefined,
      breaking: false,
      description: "add login",
      body: undefined,
      footers: new Map(),
      files: [],
    });
  });

  it("parses commit with scope", () => {
    const result = parseConventionalCommit("abc1234", "fix(core): null check");
    expect(result).toEqual({
      hash: "abc1234",
      type: "fix",
      scope: "core",
      breaking: false,
      description: "null check",
      body: undefined,
      footers: new Map(),
      files: [],
    });
  });

  it("parses breaking change with bang", () => {
    const result = parseConventionalCommit("abc1234", "feat!: remove API");
    expect(result).toEqual({
      hash: "abc1234",
      type: "feat",
      scope: undefined,
      breaking: true,
      description: "remove API",
      body: undefined,
      footers: new Map(),
      files: [],
    });
  });

  it("parses breaking change with scope and bang", () => {
    const result = parseConventionalCommit(
      "abc1234",
      "feat(auth)!: remove session API",
    );
    expect(result).toEqual({
      hash: "abc1234",
      type: "feat",
      scope: "auth",
      breaking: true,
      description: "remove session API",
      body: undefined,
      footers: new Map(),
      files: [],
    });
  });

  it("parses BREAKING CHANGE footer", () => {
    const result = parseConventionalCommit(
      "abc1234",
      "feat: change\n\nBREAKING CHANGE: removed X",
    );
    expect(result).not.toBeNull();
    expect(result!.breaking).toBe(true);
    expect(result!.footers.get("BREAKING CHANGE")).toBe("removed X");
  });

  it("parses body and footers", () => {
    const result = parseConventionalCommit(
      "abc1234",
      "fix: bug\n\nbody text\n\nRefs: #123",
    );
    expect(result).not.toBeNull();
    expect(result!.body).toBe("body text");
    expect(result!.footers.get("Refs")).toBe("#123");
  });

  it("parses BREAKING-CHANGE footer (hyphenated)", () => {
    const result = parseConventionalCommit(
      "abc1234",
      "feat: update\n\nBREAKING-CHANGE: old API removed",
    );
    expect(result).not.toBeNull();
    expect(result!.breaking).toBe(true);
  });

  it("returns null for non-conventional commit", () => {
    const result = parseConventionalCommit("abc1234", "update readme");
    expect(result).toBeNull();
  });

  it("returns null for merge commits", () => {
    const result = parseConventionalCommit(
      "abc1234",
      "Merge branch 'main' into feature",
    );
    expect(result).toBeNull();
  });

  it("accepts pre-populated files array", () => {
    const result = parseConventionalCommit("abc1234", "feat: add login", [
      "src/auth.ts",
    ]);
    expect(result).not.toBeNull();
    expect(result!.files).toEqual(["src/auth.ts"]);
  });

  it("returns null for empty message", () => {
    const result = parseConventionalCommit("abc1234", "");
    expect(result).toBeNull();
  });

  it("handles multi-line footer values", () => {
    const result = parseConventionalCommit(
      "abc1234",
      "feat: update\n\nBREAKING CHANGE: removed old API\n  migration guide at docs/migrate.md",
    );
    expect(result).not.toBeNull();
    expect(result!.breaking).toBe(true);
    expect(result!.footers.get("BREAKING CHANGE")).toContain("removed old API");
  });
});
