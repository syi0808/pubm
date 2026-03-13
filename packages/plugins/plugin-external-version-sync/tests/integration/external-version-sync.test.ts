import fs from "node:fs";
import path from "node:path";
import type { PubmContext } from "@pubm/core";
import { createContext, PluginRunner } from "@pubm/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { externalVersionSync } from "../../src/index.js";

const tmpDir = path.join(import.meta.dirname, ".tmp-ext-version-sync");

function makeCtx(version: string): PubmContext {
  const ctx = createContext({ packages: [], plugins: [] } as any, {
    testScript: "test",
    buildScript: "build",
    branch: "main",
    tag: "latest",
    saveToken: false,
  });
  ctx.runtime.version = version;
  return ctx;
}

describe("externalVersionSync integration", () => {
  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should update version in JSON and text files via afterVersion hook", async () => {
    const jsonFile = path.join(tmpDir, "manifest.json");
    const textFile = path.join(tmpDir, "version.txt");

    fs.writeFileSync(
      jsonFile,
      `${JSON.stringify({ name: "test", version: "1.0.0" }, null, 2)}\n`,
    );
    fs.writeFileSync(textFile, "Current version: 1.0.0\n");

    const plugin = externalVersionSync({
      targets: [
        { file: jsonFile, jsonPath: "version" },
        { file: textFile, pattern: /Current version: \d+\.\d+\.\d+/ },
      ],
    });

    const runner = new PluginRunner([plugin]);
    const ctx = makeCtx("2.0.0");

    await runner.runHook("afterVersion", ctx);

    const updatedJson = JSON.parse(fs.readFileSync(jsonFile, "utf-8"));
    expect(updatedJson.version).toBe("2.0.0");

    const updatedText = fs.readFileSync(textFile, "utf-8");
    expect(updatedText).toBe("Current version: 2.0.0\n");
  });

  it("should update nested JSON paths", async () => {
    const jsonFile = path.join(tmpDir, "config.json");

    fs.writeFileSync(
      jsonFile,
      JSON.stringify({ metadata: { app: { version: "1.0.0" } } }, null, 2) +
        "\n",
    );

    const plugin = externalVersionSync({
      targets: [{ file: jsonFile, jsonPath: "metadata.app.version" }],
    });

    const runner = new PluginRunner([plugin]);
    await runner.runHook("afterVersion", makeCtx("2.0.0"));

    const updated = JSON.parse(fs.readFileSync(jsonFile, "utf-8"));
    expect(updated.metadata.app.version).toBe("2.0.0");
  });

  it("should skip files already at the target version", async () => {
    const jsonFile = path.join(tmpDir, "already.json");

    fs.writeFileSync(
      jsonFile,
      `${JSON.stringify({ version: "2.0.0" }, null, 2)}\n`,
    );

    const plugin = externalVersionSync({
      targets: [{ file: jsonFile, jsonPath: "version" }],
    });

    const runner = new PluginRunner([plugin]);
    await runner.runHook("afterVersion", makeCtx("2.0.0"));

    // File should not be rewritten when version already matches
    const json = JSON.parse(fs.readFileSync(jsonFile, "utf-8"));
    expect(json.version).toBe("2.0.0");
  });

  it("should throw but still process all targets when some fail (error isolation)", async () => {
    const goodFile = path.join(tmpDir, "good.json");
    const badFile = path.join(tmpDir, "nonexistent.json");

    fs.writeFileSync(
      goodFile,
      `${JSON.stringify({ version: "1.0.0" }, null, 2)}\n`,
    );

    const plugin = externalVersionSync({
      targets: [
        { file: goodFile, jsonPath: "version" },
        { file: badFile, jsonPath: "version" },
      ],
    });

    const runner = new PluginRunner([plugin]);

    await expect(
      runner.runHook("afterVersion", makeCtx("2.0.0")),
    ).rejects.toThrow(/external-version-sync failed for 1 target/);

    // The valid target should still have been updated despite the error
    const updated = JSON.parse(fs.readFileSync(goodFile, "utf-8"));
    expect(updated.version).toBe("2.0.0");
  });

  it("should handle multiple JSON and regex targets together", async () => {
    const pkg = path.join(tmpDir, "package.json");
    const readme = path.join(tmpDir, "README.md");
    const config = path.join(tmpDir, "config.json");

    fs.writeFileSync(
      pkg,
      `${JSON.stringify({ name: "my-lib", version: "1.5.3" }, null, 2)}\n`,
    );
    fs.writeFileSync(readme, "# my-lib v1.5.3\n\nInstall `my-lib@1.5.3`\n");
    fs.writeFileSync(
      config,
      `${JSON.stringify({ deps: { core: "1.5.3" } }, null, 2)}\n`,
    );

    const plugin = externalVersionSync({
      targets: [
        { file: pkg, jsonPath: "version" },
        { file: readme, pattern: /v\d+\.\d+\.\d+/ },
        { file: config, jsonPath: "deps.core" },
      ],
    });

    const runner = new PluginRunner([plugin]);
    await runner.runHook("afterVersion", makeCtx("3.0.0"));

    const updatedPkg = JSON.parse(fs.readFileSync(pkg, "utf-8"));
    expect(updatedPkg.version).toBe("3.0.0");

    const updatedReadme = fs.readFileSync(readme, "utf-8");
    expect(updatedReadme).toContain("v3.0.0");

    const updatedConfig = JSON.parse(fs.readFileSync(config, "utf-8"));
    expect(updatedConfig.deps.core).toBe("3.0.0");
  });
});
