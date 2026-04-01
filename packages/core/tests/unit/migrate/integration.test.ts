import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  readdirSync: vi.fn().mockReturnValue([]),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  unlinkSync: vi.fn(),
  rmSync: vi.fn(),
  statSync: vi.fn(),
}));

vi.mock("../../../src/migrate/ci-advisor.js", () => ({
  scanCiWorkflows: vi.fn().mockReturnValue([]),
}));

vi.mock("../../../src/migrate/cleanup.js", () => ({
  removeFiles: vi.fn().mockReturnValue([]),
}));

import * as fs from "node:fs";
import path from "node:path";
import { npAdapter } from "../../../src/migrate/adapters/np.js";
import { semanticReleaseAdapter } from "../../../src/migrate/adapters/semantic-release.js";
import { detectMigrationSources } from "../../../src/migrate/detector.js";
import { executeMigration } from "../../../src/migrate/pipeline.js";

const mockExistsSync = vi.mocked(fs.existsSync);
const mockReadFileSync = vi.mocked(fs.readFileSync);
const mockWriteFileSync = vi.mocked(fs.writeFileSync);

const CWD = "/project";

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(fs.readdirSync).mockReturnValue([]);
  mockExistsSync.mockReturnValue(false);
  mockReadFileSync.mockReturnValue("");
});

describe("migrate integration", () => {
  describe("full pipeline: detect semantic-release → generate pubm.config.ts", () => {
    it("detects only semantic-release and writes config with expected fields", async () => {
      const releasercPath = path.join(CWD, ".releaserc.json");
      const releasercContent = JSON.stringify({
        branches: ["main"],
        plugins: [
          "@semantic-release/commit-analyzer",
          "@semantic-release/release-notes-generator",
          "@semantic-release/npm",
          [
            "@semantic-release/github",
            {
              draftRelease: true,
            },
          ],
        ],
      });

      mockExistsSync.mockImplementation((p) => p === releasercPath);
      mockReadFileSync.mockImplementation((p) => {
        if (p === releasercPath) return releasercContent;
        return "";
      });

      // Detect
      const detected = await detectMigrationSources(CWD, [
        semanticReleaseAdapter,
        npAdapter,
      ]);

      expect(detected).toHaveLength(1);
      expect(detected[0].adapter.name).toBe("semantic-release");

      // Execute migration
      const result = await executeMigration({
        adapter: detected[0].adapter,
        detected: detected[0].result,
        cwd: CWD,
        dryRun: false,
        clean: false,
      });

      expect(result.configWritten).toBe(true);

      // Verify written config content
      expect(mockWriteFileSync).toHaveBeenCalledOnce();
      const [writtenPath, writtenContent] = mockWriteFileSync.mock.calls[0] as [
        string,
        string,
        string,
      ];

      expect(writtenPath).toBe(path.join(CWD, "pubm.config.ts"));
      expect(writtenContent).toContain("defineConfig");
      expect(writtenContent).toContain('"main"');
      expect(writtenContent).toContain('"npm"');
      expect(writtenContent).toContain("releaseDraft: true");
    });
  });

  describe("dry-run does not write files", () => {
    it("does not call writeFileSync when dryRun is true", async () => {
      const npConfigPath = path.join(CWD, ".np-config.json");
      const npConfigContent = JSON.stringify({ branch: "main" });

      mockExistsSync.mockImplementation((p) => p === npConfigPath);
      mockReadFileSync.mockImplementation((p) => {
        if (p === npConfigPath) return npConfigContent;
        return "";
      });

      // Detect
      const detected = await detectMigrationSources(CWD, [npAdapter]);
      expect(detected).toHaveLength(1);

      // Execute with dry-run
      const result = await executeMigration({
        adapter: detected[0].adapter,
        detected: detected[0].result,
        cwd: CWD,
        dryRun: true,
        clean: false,
      });

      expect(result.configWritten).toBe(false);
      expect(mockWriteFileSync).not.toHaveBeenCalled();
    });
  });
});
