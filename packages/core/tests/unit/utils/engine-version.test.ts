import { describe, expect, it } from "vitest";
import { validateEngineVersion } from "../../../src/utils/engine-version.js";

describe("validateEngineVersion", () => {
  it("returns true when the version satisfies the node constraint", async () => {
    const result = await validateEngineVersion("node", "24.11.0");

    expect(result).toBe(true);
  });

  it("returns false when the version does not satisfy the node constraint", async () => {
    const result = await validateEngineVersion("node", "16.0.0");

    expect(result).toBe(false);
  });

  it("returns true for prerelease node versions when includePrerelease is enabled", async () => {
    const result = await validateEngineVersion("node", "24.0.0-rc.1");

    expect(result).toBe(true);
  });

  it("uses the pubm git engine constraint", async () => {
    expect(await validateEngineVersion("git", "2.40.0")).toBe(true);
    expect(await validateEngineVersion("git", "2.10.0")).toBe(false);
  });

  it("treats unspecified package-manager engines as wildcard ranges", async () => {
    expect(await validateEngineVersion("npm", "10.0.0")).toBe(true);
    expect(await validateEngineVersion("pnpm", "9.0.0")).toBe(true);
    expect(await validateEngineVersion("yarn", "1.22.19")).toBe(true);
  });
});
