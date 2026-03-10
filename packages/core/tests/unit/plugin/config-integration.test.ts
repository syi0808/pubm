import { describe, expect, it } from "vitest";
import type { PubmConfig } from "../../../src/config/types.js";
import type { PubmPlugin } from "../../../src/plugin/types.js";

describe("PubmConfig with plugins", () => {
  it("should accept plugins array in config", () => {
    const plugin: PubmPlugin = {
      name: "test",
      hooks: { beforePublish: async () => {} },
    };
    const config: PubmConfig = {
      plugins: [plugin],
    };
    expect(config.plugins).toHaveLength(1);
  });

  it("should work without plugins", () => {
    const config: PubmConfig = { branch: "main" };
    expect(config.plugins).toBeUndefined();
  });
});
