import { describe, expect, it } from "vitest";
import { createKeyResolver } from "../../../src/changeset/resolve.js";

describe("createKeyResolver", () => {
  const packages = [
    { name: "@pubm/core", path: "packages/core" },
    { name: "pubm", path: "packages/pubm" },
  ];

  it("returns path unchanged when key is a valid path", () => {
    const resolve = createKeyResolver(packages);
    expect(resolve("packages/core")).toBe("packages/core");
  });

  it("converts name to path", () => {
    const resolve = createKeyResolver(packages);
    expect(resolve("@pubm/core")).toBe("packages/core");
  });

  it("returns key as-is when no match found", () => {
    const resolve = createKeyResolver(packages);
    expect(resolve("unknown-pkg")).toBe("unknown-pkg");
  });
});
