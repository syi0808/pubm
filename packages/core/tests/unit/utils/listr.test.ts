import { TestRenderer } from "@pubm/runner";
import { describe, expect, it } from "vitest";
import { createCiListrOptions, createListr } from "../../../src/utils/listr.js";
import { PubmCiRenderer } from "../../../src/utils/listr-ci-renderer.js";

describe("createListr", () => {
  it("returns a pubm task runner and runs tasks", async () => {
    const order: string[] = [];
    const renderer = new TestRenderer();
    const runner = createListr(
      [
        { title: "first", task: () => order.push("first") },
        { title: "second", task: () => order.push("second") },
      ],
      { renderer },
    );

    expect(runner.isRoot()).toBe(true);
    await runner.run({});

    expect(order).toEqual(["first", "second"]);
    expect(renderer.result).toMatchObject({ status: "success" });
  });
});

describe("createCiListrOptions", () => {
  it("configures the pubm CI renderer for primary and fallback output", () => {
    const options = createCiListrOptions();

    expect(options.renderer).toBe(PubmCiRenderer);
    expect(options.fallbackRenderer).toBe(PubmCiRenderer);
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
