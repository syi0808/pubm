import { describe, expect, it } from "vitest";
import type {
  ExternalVersionSyncOptions,
  JsonTarget,
  RegexTarget,
} from "../../src/types.js";
import { isJsonTarget, isRegexTarget } from "../../src/types.js";

describe("ExternalVersionSync types", () => {
  it("should accept a JSON target", () => {
    const target: JsonTarget = { file: "plugin.json", jsonPath: "version" };
    expect(isJsonTarget(target)).toBe(true);
    expect(isRegexTarget(target)).toBe(false);
  });

  it("should accept a regex target", () => {
    const target: RegexTarget = { file: "README.md", pattern: /pubm@[\d.]+/g };
    expect(isRegexTarget(target)).toBe(true);
    expect(isJsonTarget(target)).toBe(false);
  });

  it("should accept mixed targets in options", () => {
    const options: ExternalVersionSyncOptions = {
      targets: [
        { file: "plugin.json", jsonPath: "version" },
        { file: "README.md", pattern: /pubm@[\d.]+/g },
      ],
    };
    expect(options.targets).toHaveLength(2);
  });
});
