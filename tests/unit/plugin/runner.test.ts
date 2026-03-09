import { describe, expect, it, vi } from "vitest";
import type { Ecosystem } from "../../../src/ecosystem/ecosystem.js";
import { PluginRunner } from "../../../src/plugin/runner.js";
import type { PubmPlugin } from "../../../src/plugin/types.js";
import type { Registry } from "../../../src/registry/registry.js";

function makeCtx() {
  return {
    version: "1.0.0",
    promptEnabled: false,
    cleanWorkingTree: true,
    testScript: "test",
    buildScript: "build",
    branch: "main",
    tag: "latest",
    saveToken: true,
    registries: ["npm"],
  } as any;
}

describe("PluginRunner", () => {
  it("executes hooks in registration order", async () => {
    const order: number[] = [];
    const plugin1: PubmPlugin = {
      name: "plugin-1",
      hooks: {
        beforePublish: () => {
          order.push(1);
        },
      },
    };
    const plugin2: PubmPlugin = {
      name: "plugin-2",
      hooks: {
        beforePublish: () => {
          order.push(2);
        },
      },
    };

    const runner = new PluginRunner([plugin1, plugin2]);
    await runner.runHook("beforePublish", makeCtx());

    expect(order).toEqual([1, 2]);
  });

  it("passes error to onError hooks", async () => {
    const errorSpy = vi.fn();
    const plugin: PubmPlugin = {
      name: "error-plugin",
      hooks: {
        onError: errorSpy,
      },
    };

    const runner = new PluginRunner([plugin]);
    const ctx = makeCtx();
    const error = new Error("publish failed");
    await runner.runErrorHook(ctx, error);

    expect(errorSpy).toHaveBeenCalledWith(ctx, error);
  });

  it("collects registries from plugins", () => {
    const reg1 = { name: "npm" } as unknown as Registry;
    const reg2 = { name: "jsr" } as unknown as Registry;
    const plugin1: PubmPlugin = {
      name: "plugin-1",
      registries: [reg1],
    };
    const plugin2: PubmPlugin = {
      name: "plugin-2",
      registries: [reg2],
    };

    const runner = new PluginRunner([plugin1, plugin2]);
    expect(runner.collectRegistries()).toEqual([reg1, reg2]);
  });

  it("collects ecosystems from plugins", () => {
    const eco1 = { name: "js" } as unknown as Ecosystem;
    const eco2 = { name: "rust" } as unknown as Ecosystem;
    const plugin1: PubmPlugin = {
      name: "plugin-1",
      ecosystems: [eco1],
    };
    const plugin2: PubmPlugin = {
      name: "plugin-2",
      ecosystems: [eco2],
    };

    const runner = new PluginRunner([plugin1, plugin2]);
    expect(runner.collectEcosystems()).toEqual([eco1, eco2]);
  });

  it("handles plugins without hooks gracefully", async () => {
    const plugin: PubmPlugin = {
      name: "no-hooks",
    };

    const runner = new PluginRunner([plugin]);
    await expect(
      runner.runHook("beforePublish", makeCtx()),
    ).resolves.toBeUndefined();
    await expect(
      runner.runErrorHook(makeCtx(), new Error("fail")),
    ).resolves.toBeUndefined();
    expect(runner.collectRegistries()).toEqual([]);
    expect(runner.collectEcosystems()).toEqual([]);
  });

  it("propagates hook errors", async () => {
    const plugin: PubmPlugin = {
      name: "failing-plugin",
      hooks: {
        beforePublish: () => {
          throw new Error("hook failed");
        },
      },
    };

    const runner = new PluginRunner([plugin]);
    await expect(runner.runHook("beforePublish", makeCtx())).rejects.toThrow(
      "hook failed",
    );
  });

  it("stops subsequent plugins when first plugin hook throws", async () => {
    const secondHookSpy = vi.fn();
    const plugin1: PubmPlugin = {
      name: "failing-plugin",
      hooks: {
        beforeBuild: () => {
          throw new Error("first plugin error");
        },
      },
    };
    const plugin2: PubmPlugin = {
      name: "second-plugin",
      hooks: {
        beforeBuild: secondHookSpy,
      },
    };

    const runner = new PluginRunner([plugin1, plugin2]);
    await expect(runner.runHook("beforeBuild", makeCtx())).rejects.toThrow(
      "first plugin error",
    );
    expect(secondHookSpy).not.toHaveBeenCalled();
  });

  it("handles empty plugin list", async () => {
    const runner = new PluginRunner([]);
    await expect(
      runner.runHook("beforePublish", makeCtx()),
    ).resolves.toBeUndefined();
    await expect(
      runner.runErrorHook(makeCtx(), new Error("fail")),
    ).resolves.toBeUndefined();
    expect(runner.collectRegistries()).toEqual([]);
    expect(runner.collectEcosystems()).toEqual([]);
  });
});
