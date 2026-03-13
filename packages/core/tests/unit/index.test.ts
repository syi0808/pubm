import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/tasks/runner.js", () => ({
  run: vi.fn().mockResolvedValue(undefined),
}));

import type { PubmContext } from "../../src/context.js";
import { pubm } from "../../src/index.js";
import { PluginRunner } from "../../src/plugin/runner.js";
import { run } from "../../src/tasks/runner.js";
import { makeTestContext } from "../helpers/make-context.js";

const mockedRun = vi.mocked(run);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("pubm", () => {
  it("calls run with the provided context", async () => {
    const ctx = makeTestContext({
      config: { packages: [{ path: ".", registries: ["npm", "jsr"] }] },
    });

    await pubm(ctx);

    expect(mockedRun).toHaveBeenCalledOnce();
    expect(mockedRun).toHaveBeenCalledWith(ctx);
  });

  it("initializes pluginRunner from config plugins", async () => {
    const plugin = { name: "test-plugin" };
    const ctx = makeTestContext({
      config: { plugins: [plugin] },
    });

    await pubm(ctx);

    expect(ctx.runtime.pluginRunner).toBeInstanceOf(PluginRunner);
  });

  it("propagates errors thrown by run", async () => {
    const error = new Error("Publish failed");
    mockedRun.mockRejectedValueOnce(error);

    const ctx = makeTestContext();

    await expect(pubm(ctx)).rejects.toThrow("Publish failed");
  });

  it("returns a promise that resolves to void on success", async () => {
    const ctx = makeTestContext();
    const result = await pubm(ctx);

    expect(result).toBeUndefined();
  });

  it("throws when config has discoveryEmpty", async () => {
    const ctx = makeTestContext({
      config: { discoveryEmpty: true, packages: [] },
    });

    await expect(pubm(ctx)).rejects.toThrow(
      "[pubm] No publishable packages found",
    );
    expect(mockedRun).not.toHaveBeenCalled();
  });

  it("passes the context through to run without modification", async () => {
    const ctx = makeTestContext({
      config: {
        packages: [
          { path: ".", registries: ["npm", "jsr"] },
          { path: "rust/crates/my-crate", registries: ["crates"] },
        ],
      },
      options: { testScript: "test:ci", buildScript: "build:prod" },
    });

    await pubm(ctx);

    expect(mockedRun).toHaveBeenCalledOnce();
    const passedCtx = mockedRun.mock.calls[0][0] as PubmContext;
    expect(passedCtx.config.packages).toHaveLength(2);
    expect(passedCtx.options.testScript).toBe("test:ci");
  });
});
