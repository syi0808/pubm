import { beforeEach, describe, expect, it, vi } from "vitest";
import { PubmCiRenderer } from "../../../src/utils/listr-ci-renderer.js";

const { mockListrCtor, mockListrInstance } = vi.hoisted(() => {
  const instance = {
    isRoot: () => true,
    externalSignalHandler: undefined as unknown,
  };

  return {
    mockListrInstance: instance,
    mockListrCtor: vi.fn(function () {
      return instance;
    }),
  };
});

vi.mock("listr2", () => {
  class MockListrRenderer {}

  return {
    Listr: mockListrCtor,
    ListrTaskState: {
      STARTED: "STARTED",
      COMPLETED: "COMPLETED",
    },
    ListrTaskEventType: {
      SUBTASK: "SUBTASK",
      STATE: "STATE",
      OUTPUT: "OUTPUT",
      TITLE: "TITLE",
      MESSAGE: "MESSAGE",
    },
    ListrRenderer: MockListrRenderer,
  };
});

vi.mock("../../../src/utils/rollback.js", () => {
  return {
    rollback: vi.fn(),
  };
});

let createListr: typeof import("../../../src/utils/listr.js").createListr;
let createCiListrOptions: typeof import("../../../src/utils/listr.js").createCiListrOptions;
let rollbackFn: typeof import("../../../src/utils/rollback.js").rollback;

beforeEach(async () => {
  mockListrInstance.isRoot = () => true;
  mockListrInstance.externalSignalHandler = undefined;
  mockListrCtor.mockClear();

  vi.resetModules();

  // Re-apply mocks after resetModules since hoisted mocks persist
  const listrMod = await import("../../../src/utils/listr.js");
  createListr = listrMod.createListr;
  createCiListrOptions = listrMod.createCiListrOptions;

  const rollbackMod = await import("../../../src/utils/rollback.js");
  rollbackFn = rollbackMod.rollback;
});

describe("createListr", () => {
  it("returns a Listr instance", () => {
    const result = createListr([]);

    expect(result).toBeDefined();
    expect(result).toBe(mockListrInstance);
  });

  it("overrides isRoot to always return false", () => {
    const result = createListr([]);

    expect(result.isRoot()).toBe(false);
  });

  it("sets externalSignalHandler to the rollback function", () => {
    const result = createListr([]);
    const listrWithSignalHandler = result as typeof result & {
      externalSignalHandler?: unknown;
    };

    expect(listrWithSignalHandler.externalSignalHandler).toBe(rollbackFn);
  });

  it("passes constructor options through to Listr", () => {
    const options = createCiListrOptions();

    createListr([], options);

    expect(mockListrCtor).toHaveBeenCalledWith([], options, undefined);
  });
});

describe("createCiListrOptions", () => {
  it("configures the CI renderer for both primary and fallback renderers", () => {
    const options = createCiListrOptions();

    expect(options.renderer?.name).toBe(PubmCiRenderer.name);
    expect(options.fallbackRenderer?.name).toBe(PubmCiRenderer.name);
    expect(options.rendererOptions).toEqual({ logTitleChange: true });
    expect(options.fallbackRendererOptions).toEqual({ logTitleChange: true });
  });

  it("merges custom renderer options", () => {
    const options = createCiListrOptions({
      rendererOptions: { logTitleChange: false },
    });

    expect(options.rendererOptions).toEqual({ logTitleChange: false });
    expect(options.fallbackRendererOptions).toEqual({ logTitleChange: true });
  });
});
