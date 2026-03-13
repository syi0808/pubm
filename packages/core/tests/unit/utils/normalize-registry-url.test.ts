import { describe, expect, it } from "vitest";
import { normalizeRegistryUrl } from "../../../src/utils/normalize-registry-url.js";

describe("normalizeRegistryUrl", () => {
  it("strips https protocol", () => {
    expect(normalizeRegistryUrl("https://npm.internal.com")).toBe(
      "npm.internal.com",
    );
  });

  it("strips http protocol", () => {
    expect(normalizeRegistryUrl("http://npm.internal.com")).toBe(
      "npm.internal.com",
    );
  });

  it("strips trailing slash", () => {
    expect(normalizeRegistryUrl("https://npm.internal.com/")).toBe(
      "npm.internal.com",
    );
  });

  it("preserves path segments", () => {
    expect(normalizeRegistryUrl("https://npm.internal.com/team-a/")).toBe(
      "npm.internal.com/team-a",
    );
  });

  it("handles github packages URL", () => {
    expect(normalizeRegistryUrl("https://npm.pkg.github.com")).toBe(
      "npm.pkg.github.com",
    );
  });

  it("handles URL without protocol", () => {
    expect(normalizeRegistryUrl("npm.internal.com")).toBe("npm.internal.com");
  });
});
