import { describe, expect, it } from "vitest";
import type { PubmConfig } from "../../../src/config/types.js";
import { generateConfigString } from "../../../src/migrate/config-writer.js";

describe("generateConfigString", () => {
  it("generates minimal config with branch and packages", () => {
    const config: Partial<PubmConfig> = {
      branch: "main",
      packages: [{ path: ".", registries: ["npm"] }],
    };
    const output = generateConfigString(config);

    expect(output).toContain('import { defineConfig } from "pubm"');
    expect(output).toContain("export default defineConfig(");
    expect(output).toContain('"main"');
    expect(output).toContain('"."');
    expect(output).toContain('"npm"');
    expect(output.trimEnd()).toMatch(/\);$/);
  });

  it("generates config with changelog, access, and releaseDraft", () => {
    const config: Partial<PubmConfig> = {
      branch: "main",
      changelog: true,
      access: "public",
      releaseDraft: false,
      packages: [{ path: ".", registries: ["npm", "jsr"] }],
    };
    const output = generateConfigString(config);

    expect(output).toContain("changelog: true");
    expect(output).toContain('"public"');
    expect(output).toContain("releaseDraft: false");
    // Short primitive array inlined
    expect(output).toContain('["npm", "jsr"]');
  });

  it("generates config with monorepo settings (fixed and linked)", () => {
    const config: Partial<PubmConfig> = {
      branch: "main",
      fixed: [["pkg-a", "pkg-b"]],
      linked: [["pkg-c", "pkg-d"]],
    };
    const output = generateConfigString(config);

    expect(output).toContain("fixed:");
    expect(output).toContain("linked:");
    expect(output).toContain('"pkg-a"');
    expect(output).toContain('"pkg-d"');
  });

  it("omits undefined fields", () => {
    const config: Partial<PubmConfig> = {
      branch: "release",
    };
    const output = generateConfigString(config);

    expect(output).not.toContain("packages");
    expect(output).not.toContain("changelog");
    expect(output).not.toContain("access");
    expect(output).not.toContain("undefined");
  });

  it("output starts with import line and ends with );", () => {
    const config: Partial<PubmConfig> = {
      branch: "main",
    };
    const output = generateConfigString(config);
    const lines = output.split("\n");

    expect(lines[0]).toBe('import { defineConfig } from "pubm";');
    expect(output.trimEnd()).toMatch(/\);$/);
  });

  it("inlines short primitive arrays (up to 3 items)", () => {
    const config: Partial<PubmConfig> = {
      packages: [{ path: ".", registries: ["npm", "jsr", "private"] }],
    };
    const output = generateConfigString(config);
    expect(output).toContain('["npm", "jsr", "private"]');
  });

  it("uses multi-line format for longer arrays (more than 3 items)", () => {
    const config: Partial<PubmConfig> = {
      packages: [
        {
          path: ".",
          registries: ["npm", "jsr", "npm", "jsr"] as never,
        },
      ],
    };
    const output = generateConfigString(config);
    // 4 items => multi-line
    expect(output).not.toMatch(/registries: \[.*\]/);
  });

  it("renders empty array as []", () => {
    const config: Partial<PubmConfig> = {
      ignore: [],
    };
    const output = generateConfigString(config);
    expect(output).toContain("ignore: []");
  });

  it("renders empty config body (no keys)", () => {
    const config: Partial<PubmConfig> = {};
    const output = generateConfigString(config);
    expect(output).toContain("export default defineConfig({");
    expect(output).toContain("});");
  });

  it("output ends with a trailing newline", () => {
    const config: Partial<PubmConfig> = { branch: "main" };
    const output = generateConfigString(config);
    expect(output.endsWith("\n")).toBe(true);
  });

  it("empty config also ends with a trailing newline", () => {
    const config: Partial<PubmConfig> = {};
    const output = generateConfigString(config);
    expect(output.endsWith("\n")).toBe(true);
  });
});
