import { describe, expect, it } from "vitest";
import { detectExtraneousFiles } from "../../../src/validate/extraneous-files.js";

describe("detectExtraneousFiles", () => {
  it("flags .env files", () => {
    const files = [".env", ".env.local", "src/index.ts"];
    const result = detectExtraneousFiles(files);
    expect(result).toHaveLength(2);
    expect(result[0].reason).toContain("secret");
  });

  it("flags test files", () => {
    const files = [
      "src/index.test.ts",
      "src/__tests__/foo.ts",
      "src/index.spec.js",
    ];
    const result = detectExtraneousFiles(files);
    expect(result).toHaveLength(3);
  });

  it("flags config files", () => {
    const files = [".eslintrc.js", "tsconfig.json", ".prettierrc"];
    const result = detectExtraneousFiles(files);
    expect(result.length).toBeGreaterThan(0);
  });

  it("does not flag source files", () => {
    const files = [
      "dist/index.js",
      "dist/index.d.ts",
      "package.json",
      "README.md",
    ];
    const result = detectExtraneousFiles(files);
    expect(result).toHaveLength(0);
  });

  it("flags source maps", () => {
    const files = ["dist/index.js.map", "dist/index.mjs.map"];
    const result = detectExtraneousFiles(files);
    expect(result).toHaveLength(2);
  });
});
