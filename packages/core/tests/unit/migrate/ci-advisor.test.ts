import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs");

import * as fs from "node:fs";
import path from "node:path";
import { scanCiWorkflows } from "../../../src/migrate/ci-advisor.js";

const mockExistsSync = vi.mocked(fs.existsSync);
const mockReaddirSync = vi.mocked(fs.readdirSync);
const mockReadFileSync = vi.mocked(fs.readFileSync);

const cwd = "/project";
const workflowsDir = path.join(cwd, ".github", "workflows");

beforeEach(() => {
  vi.resetAllMocks();
});

describe("scanCiWorkflows", () => {
  it("detects npx semantic-release in workflow file", () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue(["release.yml"] as unknown as fs.Dirent[]);
    mockReadFileSync.mockReturnValue(
      "jobs:\n  release:\n    steps:\n      - run: npx semantic-release\n",
    );

    const advice = scanCiWorkflows(cwd, "semantic-release");

    expect(advice).toHaveLength(1);
    expect(advice[0].file).toBe(path.join(workflowsDir, "release.yml"));
    expect(advice[0].removeLine).toBe("- run: npx semantic-release");
    expect(advice[0].addLine).toBe("npx pubm --phase publish");
  });

  it("detects changeset publish in workflow file", () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue(["publish.yml"] as unknown as fs.Dirent[]);
    mockReadFileSync.mockReturnValue(
      "steps:\n  - run: npx changeset publish\n",
    );

    const advice = scanCiWorkflows(cwd, "changesets");

    expect(advice).toHaveLength(1);
    expect(advice[0].removeLine).toBe("- run: npx changeset publish");
    expect(advice[0].addLine).toBe("npx pubm --phase publish");
  });

  it("detects npx release-it --ci in workflow file", () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue(["ci.yaml"] as unknown as fs.Dirent[]);
    mockReadFileSync.mockReturnValue("      - run: npx release-it --ci\n");

    const advice = scanCiWorkflows(cwd, "release-it");

    expect(advice).toHaveLength(1);
    expect(advice[0].removeLine).toBe("- run: npx release-it --ci");
    expect(advice[0].addLine).toBe("npx pubm --phase publish");
  });

  it("returns empty when workflows directory does not exist", () => {
    mockExistsSync.mockReturnValue(false);

    const advice = scanCiWorkflows(cwd, "semantic-release");

    expect(advice).toHaveLength(0);
    expect(mockReaddirSync).not.toHaveBeenCalled();
  });

  it("returns empty when no matching patterns in workflow files", () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue(["test.yml"] as unknown as fs.Dirent[]);
    mockReadFileSync.mockReturnValue("steps:\n  - run: npm test\n");

    const advice = scanCiWorkflows(cwd, "semantic-release");

    expect(advice).toHaveLength(0);
  });

  it("only reads .yml and .yaml files", () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue([
      "release.yml",
      "release.yaml",
      "README.md",
      "notes.txt",
    ] as unknown as fs.Dirent[]);
    mockReadFileSync.mockReturnValue("run: npm test\n");

    scanCiWorkflows(cwd, "semantic-release");

    expect(mockReadFileSync).toHaveBeenCalledTimes(2);
  });

  it("detects multiple matching lines in a single file", () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue(["release.yml"] as unknown as fs.Dirent[]);
    mockReadFileSync.mockReturnValue(
      "  - run: npx semantic-release\n  - run: npx semantic-release --dry-run\n",
    );

    const advice = scanCiWorkflows(cwd, "semantic-release");

    expect(advice).toHaveLength(2);
  });
});
