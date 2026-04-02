import { describe, expect, it, vi } from "vitest";
import { detectMigrationSources } from "../../../src/migrate/detector.js";
import type {
  DetectResult,
  MigrationSource,
} from "../../../src/migrate/types.js";

function makeAdapter(
  name: MigrationSource["name"],
  result: DetectResult,
): MigrationSource {
  return {
    name,
    configFilePatterns: [],
    detect: vi.fn().mockResolvedValue(result),
    parse: vi.fn(),
    convert: vi.fn(),
    getCleanupTargets: vi.fn(),
  } as unknown as MigrationSource;
}

const cwd = "/project";

describe("detectMigrationSources", () => {
  it("returns all detected sources when multiple adapters find results", async () => {
    const a = makeAdapter("semantic-release", {
      found: true,
      configFiles: [".releaserc"],
      relatedFiles: [],
    });
    const b = makeAdapter("np", {
      found: true,
      configFiles: ["package.json"],
      relatedFiles: [],
    });
    const c = makeAdapter("release-it", {
      found: false,
      configFiles: [],
      relatedFiles: [],
    });

    const results = await detectMigrationSources(cwd, [a, b, c]);

    expect(results).toHaveLength(2);
    expect(results[0].adapter.name).toBe("semantic-release");
    expect(results[0].result.found).toBe(true);
    expect(results[1].adapter.name).toBe("np");
    expect(a.detect).toHaveBeenCalledWith(cwd);
    expect(b.detect).toHaveBeenCalledWith(cwd);
    expect(c.detect).toHaveBeenCalledWith(cwd);
  });

  it("returns empty array when no adapters detect anything", async () => {
    const a = makeAdapter("changesets", {
      found: false,
      configFiles: [],
      relatedFiles: [],
    });

    const results = await detectMigrationSources(cwd, [a]);

    expect(results).toHaveLength(0);
  });

  it("filters by --from option, returning only the matching adapter", async () => {
    const a = makeAdapter("semantic-release", {
      found: true,
      configFiles: [".releaserc"],
      relatedFiles: [],
    });
    const b = makeAdapter("np", {
      found: true,
      configFiles: ["package.json"],
      relatedFiles: [],
    });

    const results = await detectMigrationSources(cwd, [a, b], "np");

    expect(results).toHaveLength(1);
    expect(results[0].adapter.name).toBe("np");
    expect(a.detect).not.toHaveBeenCalled();
    expect(b.detect).toHaveBeenCalledWith(cwd);
  });

  it("returns empty when --from adapter is not in the adapters list", async () => {
    const a = makeAdapter("semantic-release", {
      found: true,
      configFiles: [".releaserc"],
      relatedFiles: [],
    });

    const results = await detectMigrationSources(cwd, [a], "np");

    expect(results).toHaveLength(0);
    expect(a.detect).not.toHaveBeenCalled();
  });

  it("silently ignores adapters that throw during detect", async () => {
    const failing: MigrationSource = {
      name: "semantic-release",
      configFilePatterns: [],
      detect: vi.fn().mockRejectedValue(new Error("detect failed")),
      parse: vi.fn(),
      convert: vi.fn(),
      getCleanupTargets: vi.fn(),
    } as unknown as MigrationSource;
    const working = makeAdapter("np", {
      found: true,
      configFiles: ["package.json"],
      relatedFiles: [],
    });

    const results = await detectMigrationSources(cwd, [failing, working]);

    expect(results).toHaveLength(1);
    expect(results[0].adapter.name).toBe("np");
  });
});
