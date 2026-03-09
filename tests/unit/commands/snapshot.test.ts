import { describe, expect, it } from "vitest";
import { generateSnapshotVersion } from "../../../src/prerelease/snapshot.js";

describe("snapshot version generation", () => {
  it("should generate timestamp-based version by default", () => {
    const version = generateSnapshotVersion({});
    expect(version).toMatch(/^0\.0\.0-snapshot-\d{8}T\d{6}$/);
  });

  it("should use custom tag", () => {
    const version = generateSnapshotVersion({ tag: "canary" });
    expect(version).toMatch(/^0\.0\.0-canary-\d{8}T\d{6}$/);
  });

  it("should use base version when useCalculatedVersion is true", () => {
    const version = generateSnapshotVersion({
      baseVersion: "1.2.3",
      useCalculatedVersion: true,
    });
    expect(version).toMatch(/^1\.2\.3-snapshot-\d{8}T\d{6}$/);
  });

  it("should use custom commit in template", () => {
    const version = generateSnapshotVersion({
      template: "{base}-{tag}-{commit}",
      commit: "abc1234",
    });
    expect(version).toBe("0.0.0-snapshot-abc1234");
  });
});
