import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discoverVersionReferences } from "../../../src/commands/sync.js";

describe("discoverVersionReferences", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), "pubm-sync-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("finds version in JSON files", () => {
    writeFileSync(
      path.join(tempDir, "config.json"),
      JSON.stringify({ version: "1.2.3", name: "test" }),
    );

    return discoverVersionReferences(tempDir, "1.2.3").then((refs) => {
      expect(refs).toHaveLength(1);
      expect(refs[0]).toEqual({
        file: "config.json",
        type: "json",
        jsonPath: "version",
      });
    });
  });

  it("finds nested version in JSON files", () => {
    writeFileSync(
      path.join(tempDir, "nested.json"),
      JSON.stringify({ meta: { version: "2.0.0" } }),
    );

    return discoverVersionReferences(tempDir, "2.0.0").then((refs) => {
      expect(refs).toHaveLength(1);
      expect(refs[0]).toEqual({
        file: "nested.json",
        type: "json",
        jsonPath: "meta.version",
      });
    });
  });

  it("skips malformed JSON files instead of aborting the scan", () => {
    writeFileSync(path.join(tempDir, "broken.json"), '{"version":"1.2.3"');
    writeFileSync(
      path.join(tempDir, "valid.json"),
      JSON.stringify({ version: "1.2.3" }),
    );

    return discoverVersionReferences(tempDir, "1.2.3").then((refs) => {
      expect(refs).toHaveLength(1);
      expect(refs[0]).toEqual({
        file: "valid.json",
        type: "json",
        jsonPath: "version",
      });
    });
  });

  it("excludes package.json from results", () => {
    writeFileSync(
      path.join(tempDir, "package.json"),
      JSON.stringify({ version: "1.0.0" }),
    );
    writeFileSync(
      path.join(tempDir, "other.json"),
      JSON.stringify({ version: "1.0.0" }),
    );

    return discoverVersionReferences(tempDir, "1.0.0").then((refs) => {
      expect(refs).toHaveLength(1);
      expect(refs[0].file).toBe("other.json");
    });
  });

  it("finds version patterns in text files", () => {
    writeFileSync(
      path.join(tempDir, "README.txt"),
      '# My Package\n\n"version": "3.0.0"\n\nSome other text\n',
    );

    return discoverVersionReferences(tempDir, "3.0.0").then((refs) => {
      expect(refs).toHaveLength(1);
      expect(refs[0]).toEqual({
        file: "README.txt",
        type: "pattern",
        match: '"version": "3.0.0"',
        line: 3,
      });
    });
  });

  it("finds @version pattern in text files", () => {
    writeFileSync(
      path.join(tempDir, "header.ts"),
      "/**\n * @version 1.5.0\n */\n",
    );

    return discoverVersionReferences(tempDir, "1.5.0").then((refs) => {
      expect(refs).toHaveLength(1);
      expect(refs[0].type).toBe("pattern");
      expect(refs[0].match).toBe("* @version 1.5.0");
      expect(refs[0].line).toBe(2);
    });
  });

  it("excludes node_modules directory", () => {
    const nmDir = path.join(tempDir, "node_modules", "some-pkg");
    mkdirSync(nmDir, { recursive: true });
    writeFileSync(
      path.join(nmDir, "config.json"),
      JSON.stringify({ version: "1.0.0" }),
    );

    return discoverVersionReferences(tempDir, "1.0.0").then((refs) => {
      expect(refs).toHaveLength(0);
    });
  });

  it("excludes dotfile directories except .claude-plugin", () => {
    const hiddenDir = path.join(tempDir, ".hidden");
    mkdirSync(hiddenDir, { recursive: true });
    writeFileSync(
      path.join(hiddenDir, "config.json"),
      JSON.stringify({ version: "1.0.0" }),
    );

    return discoverVersionReferences(tempDir, "1.0.0").then((refs) => {
      expect(refs).toHaveLength(0);
    });
  });

  it("still scans .claude-plugin because plugin manifests can track release versions", () => {
    const pluginDir = path.join(tempDir, ".claude-plugin");
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(
      path.join(pluginDir, "manifest.json"),
      JSON.stringify({ version: "1.0.0" }),
    );

    return discoverVersionReferences(tempDir, "1.0.0").then((refs) => {
      expect(refs).toHaveLength(1);
      expect(refs[0]).toEqual({
        file: ".claude-plugin/manifest.json",
        type: "json",
        jsonPath: "version",
      });
    });
  });

  it("excludes other skipped files like jsr.json and lock files", () => {
    writeFileSync(
      path.join(tempDir, "jsr.json"),
      JSON.stringify({ version: "1.0.0" }),
    );
    writeFileSync(path.join(tempDir, "pnpm-lock.yaml"), '"version": "1.0.0"\n');

    return discoverVersionReferences(tempDir, "1.0.0").then((refs) => {
      expect(refs).toHaveLength(0);
    });
  });

  it("scans subdirectories recursively", () => {
    const subDir = path.join(tempDir, "src", "config");
    mkdirSync(subDir, { recursive: true });
    writeFileSync(
      path.join(subDir, "meta.json"),
      JSON.stringify({ version: "4.0.0" }),
    );

    return discoverVersionReferences(tempDir, "4.0.0").then((refs) => {
      expect(refs).toHaveLength(1);
      expect(refs[0].file).toBe("src/config/meta.json");
    });
  });
});
