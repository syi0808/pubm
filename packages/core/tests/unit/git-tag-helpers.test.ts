import { describe, expect, it } from "vitest";
import { extractPrefix, extractVersion } from "../../src/git.js";

describe("extractVersion", () => {
  it("extracts from scoped package tag", () => {
    expect(extractVersion("@pubm/core@0.4.0")).toBe("0.4.0");
  });
  it("extracts from unscoped package tag", () => {
    expect(extractVersion("pubm@0.4.0")).toBe("0.4.0");
  });
  it("extracts from v-prefix tag", () => {
    expect(extractVersion("v0.4.0")).toBe("0.4.0");
  });
  it("extracts from bare version tag", () => {
    expect(extractVersion("0.4.0")).toBe("0.4.0");
  });
  it("handles prerelease versions", () => {
    expect(extractVersion("@pubm/core@1.0.0-beta.1")).toBe("1.0.0-beta.1");
  });
});

describe("extractPrefix", () => {
  it("extracts scoped package prefix", () => {
    expect(extractPrefix("@pubm/core@0.4.0")).toBe("@pubm/core");
  });
  it("extracts unscoped package prefix", () => {
    expect(extractPrefix("pubm@0.4.0")).toBe("pubm");
  });
  it("extracts v prefix", () => {
    expect(extractPrefix("v0.4.0")).toBe("v");
  });
  it("returns empty for bare version", () => {
    expect(extractPrefix("0.4.0")).toBe("");
  });
});
