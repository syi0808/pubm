import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { syncVersionInFile } from "../../src/sync.js";
import type { JsonTarget, RegexTarget } from "../../src/types.js";

const tmpDir = join(import.meta.dirname, ".tmp-sync-test");

beforeEach(() => {
  mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("syncVersionInFile", () => {
  it("updates JSON file at jsonPath", () => {
    const filePath = join(tmpDir, "package.json");
    writeFileSync(filePath, JSON.stringify({ version: "0.1.0" }, null, "  "));

    const target: JsonTarget = { file: filePath, jsonPath: "version" };
    const changed = syncVersionInFile(filePath, "1.0.0", target);

    expect(changed).toBe(true);
    const result = JSON.parse(readFileSync(filePath, "utf-8"));
    expect(result.version).toBe("1.0.0");
  });

  it("updates nested JSON path", () => {
    const filePath = join(tmpDir, "config.json");
    const data = { metadata: { version: "0.2.0" }, name: "test" };
    writeFileSync(filePath, JSON.stringify(data, null, "  "));

    const target: JsonTarget = { file: filePath, jsonPath: "metadata.version" };
    const changed = syncVersionInFile(filePath, "1.0.0", target);

    expect(changed).toBe(true);
    const result = JSON.parse(readFileSync(filePath, "utf-8"));
    expect(result.metadata.version).toBe("1.0.0");
    expect(result.name).toBe("test");
  });

  it("updates text file with regex pattern", () => {
    const filePath = join(tmpDir, "README.md");
    writeFileSync(filePath, "Current version is 0.2.12\n");

    const target: RegexTarget = {
      file: filePath,
      pattern: /version is \d+\.\d+\.\d+/,
    };
    const changed = syncVersionInFile(filePath, "1.0.0", target);

    expect(changed).toBe(true);
    const content = readFileSync(filePath, "utf-8");
    expect(content).toBe("Current version is 1.0.0\n");
  });

  it("returns false when no changes needed", () => {
    const filePath = join(tmpDir, "package.json");
    writeFileSync(filePath, JSON.stringify({ version: "1.0.0" }, null, "  "));

    const target: JsonTarget = { file: filePath, jsonPath: "version" };
    const changed = syncVersionInFile(filePath, "1.0.0", target);

    expect(changed).toBe(false);
  });

  it("handles regex with version prefix", () => {
    const filePath = join(tmpDir, "action.yml");
    writeFileSync(filePath, "uses: my-action@v0.2.12\n");

    const target: RegexTarget = {
      file: filePath,
      pattern: /my-action@v\d+\.\d+\.\d+/,
    };
    const changed = syncVersionInFile(filePath, "1.0.0", target);

    expect(changed).toBe(true);
    const content = readFileSync(filePath, "utf-8");
    expect(content).toBe("uses: my-action@v1.0.0\n");
  });

  it("throws when file not found", () => {
    const filePath = join(tmpDir, "nonexistent.json");
    const target: JsonTarget = { file: filePath, jsonPath: "version" };

    expect(() => syncVersionInFile(filePath, "1.0.0", target)).toThrow(
      `File not found: ${filePath}`,
    );
  });

  it("throws on invalid JSON", () => {
    const filePath = join(tmpDir, "bad.json");
    writeFileSync(filePath, "{ not valid json }}}");

    const target: JsonTarget = { file: filePath, jsonPath: "version" };

    expect(() => syncVersionInFile(filePath, "1.0.0", target)).toThrow(
      `Failed to parse JSON in ${filePath}:`,
    );
  });

  it("throws on invalid nested path", () => {
    const filePath = join(tmpDir, "shallow.json");
    writeFileSync(filePath, JSON.stringify({ name: "test" }, null, "  "));

    const target: JsonTarget = {
      file: filePath,
      jsonPath: "deeply.nested.version",
    };

    expect(() => syncVersionInFile(filePath, "1.0.0", target)).toThrow(
      "Invalid path",
    );
  });
});
