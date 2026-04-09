import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateSnapshotVersion } from "../../../src/utils/snapshot.js";

describe("generateSnapshotVersion", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-04T12:30:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should generate snapshot version with base version", () => {
    const result = generateSnapshotVersion({
      tag: "canary",
      baseVersion: "1.2.0",
    });
    expect(result).toBe("1.2.0-canary-20260304T123000");
  });

  it("should use custom template", () => {
    const result = generateSnapshotVersion({
      tag: "dev",
      baseVersion: "1.0.0",
      template: "{tag}-{commit}",
      commit: "abc1234",
    });
    expect(result).toBe("1.0.0-dev-abc1234");
  });

  it("replaces {commit} with empty string when commit is not provided", () => {
    const result = generateSnapshotVersion({
      tag: "dev",
      baseVersion: "1.0.0",
      template: "{tag}-{commit}",
    });
    expect(result).toBe("1.0.0-dev-");
  });

  it("should replace all placeholders including timestamp in template", () => {
    const result = generateSnapshotVersion({
      tag: "beta",
      baseVersion: "2.0.0",
      template: "{tag}-{timestamp}-{commit}",
      commit: "abc1234",
    });
    expect(result).toBe("2.0.0-beta-20260304T123000-abc1234");
  });

  it("should default tag to snapshot", () => {
    const result = generateSnapshotVersion({ baseVersion: "2.0.0" });
    expect(result).toBe("2.0.0-snapshot-20260304T123000");
  });
});
