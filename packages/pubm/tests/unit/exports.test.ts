import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

const mockCore = vi.hoisted(() => ({
  PUBM_VERSION: "0.3.6",
  defineConfig: vi.fn((config) => config),
  pubm: vi.fn(),
}));

vi.mock("@pubm/core", () => mockCore);

describe("pubm package exports", () => {
  it("re-exports the @pubm/core API from the package root", async () => {
    const mod = await import("../../index.js");

    expect(mod.defineConfig).toBe(mockCore.defineConfig);
    expect(mod.pubm).toBe(mockCore.pubm);
    expect(mod.PUBM_VERSION).toBe(mockCore.PUBM_VERSION);
  });

  it("declares exports for the root API and CLI bin", () => {
    const packageJson = JSON.parse(
      readFileSync(new URL("../../package.json", import.meta.url), "utf-8"),
    ) as {
      exports: Record<string, unknown>;
      main: string;
      module: string;
      types: string;
    };

    expect(packageJson.main).toBe("./index.cjs");
    expect(packageJson.module).toBe("./index.js");
    expect(packageJson.types).toBe("./index.d.ts");
    expect(packageJson.exports["."]).toEqual({
      types: "./index.d.ts",
      import: "./index.js",
      require: "./index.cjs",
    });
    expect(packageJson.exports["./bin"]).toBe("./bin/cli.cjs");
  });
});
