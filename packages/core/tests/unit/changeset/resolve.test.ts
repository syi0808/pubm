import { describe, expect, it } from "vitest";
import { createKeyResolver } from "../../../src/changeset/resolve.js";

describe("createKeyResolver", () => {
  const packages = [
    { name: "@pubm/core", path: "packages/core", ecosystem: "js" },
    { name: "pubm", path: "packages/pubm", ecosystem: "js" },
  ];

  it("returns packageKey unchanged when key is already in path::ecosystem format", () => {
    const resolve = createKeyResolver(packages);
    expect(resolve("packages/core::js")).toBe("packages/core::js");
  });

  it("converts name to packageKey", () => {
    const resolve = createKeyResolver(packages);
    expect(resolve("@pubm/core")).toBe("packages/core::js");
  });

  it("auto-resolves legacy path when single ecosystem at that path", () => {
    const resolve = createKeyResolver(packages);
    expect(resolve("packages/pubm")).toBe("packages/pubm::js");
  });

  it("returns key as-is when no match found", () => {
    const resolve = createKeyResolver(packages);
    expect(resolve("unknown-pkg")).toBe("unknown-pkg");
  });
});

describe("createKeyResolver with multi-ecosystem", () => {
  const packages = [
    { name: "@pubm/core", path: "packages/core", ecosystem: "js" },
    { name: "pubm-rs", path: "packages/core", ecosystem: "rust" },
    { name: "pubm", path: "packages/pubm", ecosystem: "js" },
  ];

  it("throws for legacy path when multiple ecosystems at that path", () => {
    const resolve = createKeyResolver(packages);
    expect(() => resolve("packages/core")).toThrow(/ambiguous/i);
  });
});
