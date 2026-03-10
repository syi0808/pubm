import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { externalVersionSync } from "../../../../src/plugins/external-version-sync/index.js";
import type { Ctx } from "../../../../src/tasks/runner.js";

const tmpDir = join(import.meta.dirname, ".tmp-plugin-test");

beforeEach(() => {
  mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("externalVersionSync", () => {
  it("returns a PubmPlugin with correct name", () => {
    const plugin = externalVersionSync({ targets: [] });

    expect(plugin.name).toBe("external-version-sync");
  });

  it("has an afterVersion hook", () => {
    const plugin = externalVersionSync({ targets: [] });

    expect(plugin.hooks).toBeDefined();
    expect(plugin.hooks?.afterVersion).toBeTypeOf("function");
  });

  it("syncs version in JSON files when afterVersion is called", async () => {
    const filePath = join(tmpDir, "manifest.json");
    writeFileSync(filePath, JSON.stringify({ version: "0.0.0" }, null, "  "));

    const plugin = externalVersionSync({
      targets: [{ file: filePath, jsonPath: "version" }],
    });

    const ctx = { version: "1.0.0" } as Ctx;
    await plugin.hooks?.afterVersion?.(ctx);

    const result = JSON.parse(readFileSync(filePath, "utf-8"));
    expect(result.version).toBe("1.0.0");
  });

  it("syncs version in multiple files", async () => {
    const jsonFile = join(tmpDir, "package.json");
    const textFile = join(tmpDir, "version.txt");
    writeFileSync(jsonFile, JSON.stringify({ version: "0.0.0" }, null, "  "));
    writeFileSync(textFile, "version = 0.0.0\n");

    const plugin = externalVersionSync({
      targets: [
        { file: jsonFile, jsonPath: "version" },
        { file: textFile, pattern: /version = \d+\.\d+\.\d+/ },
      ],
    });

    const ctx = { version: "2.0.0" } as Ctx;
    await plugin.hooks?.afterVersion?.(ctx);

    const jsonResult = JSON.parse(readFileSync(jsonFile, "utf-8"));
    expect(jsonResult.version).toBe("2.0.0");

    const textResult = readFileSync(textFile, "utf-8");
    expect(textResult).toBe("version = 2.0.0\n");
  });

  it("resolves relative file paths from cwd", async () => {
    const filePath = join(tmpDir, "config.json");
    writeFileSync(filePath, JSON.stringify({ ver: "0.0.0" }, null, "  "));

    const plugin = externalVersionSync({
      targets: [{ file: filePath, jsonPath: "ver" }],
    });

    const ctx = { version: "3.0.0" } as Ctx;
    await plugin.hooks?.afterVersion?.(ctx);

    const result = JSON.parse(readFileSync(filePath, "utf-8"));
    expect(result.ver).toBe("3.0.0");
  });

  it("syncs version without console output", async () => {
    const filePath = join(tmpDir, "app.json");
    writeFileSync(filePath, JSON.stringify({ version: "0.0.0" }, null, "  "));

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const plugin = externalVersionSync({
      targets: [{ file: filePath, jsonPath: "version" }],
    });

    const ctx = { version: "1.0.0" } as Ctx;
    await plugin.hooks?.afterVersion?.(ctx);

    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();

    const result = JSON.parse(readFileSync(filePath, "utf-8"));
    expect(result.version).toBe("1.0.0");
  });

  it("continues processing after one target fails", async () => {
    const missingFile = join(tmpDir, "nonexistent", "missing.json");
    const validFile = join(tmpDir, "valid.json");
    writeFileSync(validFile, JSON.stringify({ version: "0.0.0" }, null, "  "));

    const plugin = externalVersionSync({
      targets: [
        { file: missingFile, jsonPath: "version" },
        { file: validFile, jsonPath: "version" },
      ],
    });

    const ctx = { version: "1.0.0" } as Ctx;
    await expect(plugin.hooks?.afterVersion?.(ctx)).rejects.toThrow(
      "failed for 1 target(s)",
    );

    const result = JSON.parse(readFileSync(validFile, "utf-8"));
    expect(result.version).toBe("1.0.0");
  });

  it("empty targets array works fine", async () => {
    const plugin = externalVersionSync({ targets: [] });

    const ctx = { version: "1.0.0" } as Ctx;
    await expect(plugin.hooks?.afterVersion?.(ctx)).resolves.toBeUndefined();
  });

  it("all targets failing throws aggregated error", async () => {
    const missingFile1 = join(tmpDir, "nonexistent1", "a.json");
    const missingFile2 = join(tmpDir, "nonexistent2", "b.json");

    const plugin = externalVersionSync({
      targets: [
        { file: missingFile1, jsonPath: "version" },
        { file: missingFile2, jsonPath: "version" },
      ],
    });

    const ctx = { version: "1.0.0" } as Ctx;
    await expect(plugin.hooks?.afterVersion?.(ctx)).rejects.toThrow(
      "failed for 2 target(s)",
    );
  });

  it("does not log when file is already up to date", async () => {
    const filePath = join(tmpDir, "app.json");
    writeFileSync(filePath, JSON.stringify({ version: "1.0.0" }, null, "  "));

    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const plugin = externalVersionSync({
      targets: [{ file: filePath, jsonPath: "version" }],
    });

    const ctx = { version: "1.0.0" } as Ctx;
    await plugin.hooks?.afterVersion?.(ctx);

    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
