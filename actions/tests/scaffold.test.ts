import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const root = path.resolve(import.meta.dirname, "..");

function readAction(actionPath: string): Record<string, any> {
  return parse(readFileSync(path.join(root, actionPath, "action.yml"), "utf8"));
}

describe("action scaffold", () => {
  it("keeps changeset-check as a sub-action with the existing inputs", () => {
    const action = readAction("changeset-check");

    expect(action.name).toBe("pubm Changeset Check");
    expect(action.runs.main).toBe("dist/index.js");
    expect(Object.keys(action.inputs)).toEqual([
      "skip-label",
      "comment",
      "token",
      "working-directory",
    ]);
    expect(Object.keys(action.outputs)).toEqual([
      "status",
      "changeset-files",
      "errors",
    ]);
  });

  it("declares placeholder sub-actions for release-pr and publish", () => {
    expect(readAction("release-pr").runs.main).toBe("dist/index.js");
    expect(readAction("publish").runs.main).toBe("dist/index.js");
  });

  it("builds each sub-action bundle to its action directory", () => {
    const packageJson = JSON.parse(
      readFileSync(path.join(root, "package.json"), "utf8"),
    );
    const buildScript = readFileSync(
      path.join(root, "scripts", "build.mjs"),
      "utf8",
    );

    expect(packageJson.scripts.build).toBe("node scripts/build.mjs");
    expect(buildScript).toContain('"changeset-check/dist/index.js"');
    expect(buildScript).toContain('"release-pr/dist/index.js"');
    expect(buildScript).toContain('"publish/dist/index.js"');
    expect(buildScript).toContain("__pubmCreateRequire");
  });
});
