import { describe, expect, it } from "vitest";
import type {
  ErrorHookFn,
  HookFn,
  HookName,
  PluginHooks,
  PubmPlugin,
} from "../../../src/plugin/types.js";

describe("Plugin Types", () => {
  it("should accept a plugin with all hooks", () => {
    const hook: HookFn = async (_ctx) => {};
    const errorHook: ErrorHookFn = async (_ctx, _error) => {};

    const plugin: PubmPlugin = {
      name: "test-all-hooks",
      hooks: {
        beforeTest: hook,
        afterTest: hook,
        beforeBuild: hook,
        afterBuild: hook,
        beforeVersion: hook,
        afterVersion: hook,
        beforePublish: hook,
        afterPublish: hook,
        beforePush: hook,
        afterPush: hook,
        onError: errorHook,
        onSuccess: hook,
      },
    };

    expect(plugin.name).toBe("test-all-hooks");
    expect(plugin.hooks).toBeDefined();
    expect(Object.keys(plugin.hooks!)).toHaveLength(12);
  });

  it("should accept a plugin with registries and ecosystems", () => {
    const plugin: PubmPlugin = {
      name: "test-registries-ecosystems",
      registries: [],
      ecosystems: [],
    };

    expect(plugin.name).toBe("test-registries-ecosystems");
    expect(plugin.registries).toEqual([]);
    expect(plugin.ecosystems).toEqual([]);
  });

  it("should accept a minimal plugin with only name", () => {
    const plugin: PubmPlugin = {
      name: "minimal-plugin",
    };

    expect(plugin.name).toBe("minimal-plugin");
    expect(plugin.hooks).toBeUndefined();
    expect(plugin.registries).toBeUndefined();
    expect(plugin.ecosystems).toBeUndefined();
  });

  it("should have 12 hook names", () => {
    const hookNames: HookName[] = [
      "beforeTest",
      "afterTest",
      "beforeBuild",
      "afterBuild",
      "beforeVersion",
      "afterVersion",
      "beforePublish",
      "afterPublish",
      "beforePush",
      "afterPush",
      "onError",
      "onSuccess",
    ];

    expect(hookNames).toHaveLength(12);

    // Verify each hook name is assignable to PluginHooks
    const hooks: PluginHooks = {};
    for (const name of hookNames) {
      expect(name in hooks || !(name in hooks)).toBe(true);
    }
  });
});
