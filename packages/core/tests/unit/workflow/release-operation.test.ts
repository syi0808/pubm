import { describe, expect, it, vi } from "vitest";
import type { PubmContext } from "../../../src/context.js";
import {
  type ReleaseOperation,
  runReleaseOperations,
} from "../../../src/workflow/release-operation.js";

const ctx = {} as PubmContext;

describe("runReleaseOperations", () => {
  it("runs enabled operations sequentially and skips disabled operations", async () => {
    const calls: string[] = [];

    await runReleaseOperations(ctx, [
      { title: "first", run: () => calls.push("first") },
      { title: "disabled", enabled: false, run: () => calls.push("disabled") },
      {
        title: "enabled-fn",
        enabled: () => true,
        run: () => calls.push("enabled-fn"),
      },
    ]);

    expect(calls).toEqual(["first", "enabled-fn"]);
  });

  it("honors static, functional, and in-body skips", async () => {
    const calls: string[] = [];

    await runReleaseOperations(ctx, [
      { title: "static-skip", skip: true, run: () => calls.push("static") },
      {
        title: "function-skip",
        skip: () => "reason",
        run: () => calls.push("function"),
      },
      {
        title: "body-skip",
        run: (_ctx, operation) => {
          operation.skip("skip from body");
        },
      },
      { title: "after", run: () => calls.push("after") },
    ]);

    expect(calls).toEqual(["after"]);
  });

  it("lets nested operations share the same context", async () => {
    const calls: string[] = [];

    await runReleaseOperations(ctx, {
      title: "parent",
      run: (_ctx, operation) =>
        operation.runOperations([
          { title: "child-a", run: () => calls.push("child-a") },
          { title: "child-b", run: () => calls.push("child-b") },
        ]),
    });

    expect(calls).toEqual(["child-a", "child-b"]);
  });

  it("waits for every concurrent operation before surfacing failures", async () => {
    const completed: string[] = [];
    const operations: ReleaseOperation[] = [
      {
        title: "fail-a",
        run: async () => {
          throw new Error("a");
        },
      },
      {
        title: "finish",
        run: async () => {
          completed.push("finish");
        },
      },
      {
        title: "fail-b",
        run: async () => {
          throw new Error("b");
        },
      },
    ];

    await expect(
      runReleaseOperations(ctx, operations, { concurrent: true }),
    ).rejects.toMatchObject({
      name: "MultipleReleaseOperationsError",
      errors: [expect.any(Error), expect.any(Error)],
    });
    expect(completed).toEqual(["finish"]);
  });

  it("uses numeric concurrency limits and preserves single-error identity", async () => {
    let active = 0;
    let maxActive = 0;
    const error = new Error("boom");
    const release = vi.fn<() => void>();

    const operations: ReleaseOperation[] = Array.from(
      { length: 3 },
      (_, i) => ({
        title: `op-${i}`,
        run: async () => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
          active -= 1;
          release();
          if (i === 2) throw error;
        },
      }),
    );

    await expect(
      runReleaseOperations(ctx, operations, { concurrent: 2 }),
    ).rejects.toBe(error);
    expect(maxActive).toBeLessThanOrEqual(2);
    expect(release).toHaveBeenCalledTimes(3);
  });
});
