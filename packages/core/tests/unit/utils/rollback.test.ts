import { beforeEach, describe, expect, it, vi } from "vitest";
import { RollbackTracker } from "../../../src/utils/rollback.js";

type TestCtx = { id: number };

describe("RollbackTracker", () => {
  let tracker: RollbackTracker<TestCtx>;
  const ctx: TestCtx = { id: 1 };

  beforeEach(() => {
    tracker = new RollbackTracker();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  describe("add", () => {
    it("accepts actions without throwing", () => {
      expect(() =>
        tracker.add({
          label: "test",
          fn: async () => {},
        }),
      ).not.toThrow();
    });
  });

  describe("execute", () => {
    it("runs actions in LIFO order", async () => {
      const order: number[] = [];
      tracker.add({
        label: "first",
        fn: async () => {
          order.push(1);
        },
      });
      tracker.add({
        label: "second",
        fn: async () => {
          order.push(2);
        },
      });
      tracker.add({
        label: "third",
        fn: async () => {
          order.push(3);
        },
      });

      await tracker.execute(ctx, { interactive: false });

      expect(order).toEqual([3, 2, 1]);
    });

    it("is idempotent — second call is a no-op", async () => {
      const fn = vi.fn();
      tracker.add({ label: "test", fn });

      await tracker.execute(ctx, { interactive: false });
      await tracker.execute(ctx, { interactive: false });

      expect(fn).toHaveBeenCalledOnce();
    });

    it("does nothing when no actions registered", async () => {
      await tracker.execute(ctx, { interactive: false });
    });

    it("continues when an action throws", async () => {
      const fn1 = vi.fn().mockRejectedValue(new Error("fail"));
      const fn2 = vi.fn();
      tracker.add({ label: "will-succeed", fn: fn2 });
      tracker.add({ label: "will-fail", fn: fn1 });

      await tracker.execute(ctx, { interactive: false });

      expect(fn1).toHaveBeenCalledOnce();
      expect(fn2).toHaveBeenCalledOnce();
    });

    it("passes ctx to each action", async () => {
      const fn = vi.fn();
      tracker.add({ label: "test", fn });

      await tracker.execute(ctx, { interactive: false });

      expect(fn).toHaveBeenCalledWith(ctx);
    });

    it("returns result with succeeded count", async () => {
      tracker.add({ label: "a", fn: async () => {} });
      tracker.add({ label: "b", fn: async () => {} });

      const result = await tracker.execute(ctx, { interactive: false });

      expect(result.succeeded).toBe(2);
      expect(result.failed).toBe(0);
      expect(result.skipped).toBe(0);
    });

    it("returns result with failed count and manual recovery", async () => {
      tracker.add({ label: "good", fn: async () => {} });
      tracker.add({
        label: "bad",
        fn: vi.fn().mockRejectedValue(new Error("oops")),
      });

      const result = await tracker.execute(ctx, { interactive: false });

      expect(result.succeeded).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.manualRecovery).toContain("bad");
    });

    it("handles non-Error rejection reasons", async () => {
      tracker.add({
        label: "string-reject",
        fn: vi.fn().mockRejectedValue("string error"),
      });

      const result = await tracker.execute(ctx, { interactive: false });

      expect(result.failed).toBe(1);
    });
  });

  describe("confirm actions", () => {
    it("auto-executes confirm actions in CI (interactive: false, sigint: false)", async () => {
      const fn = vi.fn();
      tracker.add({ label: "unpublish", fn, confirm: true });

      await tracker.execute(ctx, { interactive: false });

      expect(fn).toHaveBeenCalledOnce();
    });

    it("skips confirm actions on SIGINT", async () => {
      const fn = vi.fn();
      tracker.add({ label: "unpublish", fn, confirm: true });

      const result = await tracker.execute(ctx, {
        interactive: false,
        sigint: true,
      });

      expect(fn).not.toHaveBeenCalled();
      expect(result.skipped).toBe(1);
      expect(result.manualRecovery).toContain("unpublish");
    });

    it("executes non-confirm actions even on SIGINT", async () => {
      const confirmFn = vi.fn();
      const normalFn = vi.fn();
      tracker.add({ label: "normal", fn: normalFn });
      tracker.add({ label: "confirm", fn: confirmFn, confirm: true });

      await tracker.execute(ctx, { interactive: false, sigint: true });

      expect(confirmFn).not.toHaveBeenCalled();
      expect(normalFn).toHaveBeenCalledOnce();
    });
  });

  describe("reset", () => {
    it("allows re-execution after reset", async () => {
      const fn = vi.fn();
      tracker.add({ label: "test", fn });

      await tracker.execute(ctx, { interactive: false });
      expect(fn).toHaveBeenCalledOnce();

      tracker.reset();
      tracker.add({ label: "test2", fn });
      await tracker.execute(ctx, { interactive: false });

      expect(fn).toHaveBeenCalledTimes(2);
    });
  });

  describe("size", () => {
    it("returns number of registered actions", () => {
      expect(tracker.size).toBe(0);
      tracker.add({ label: "a", fn: async () => {} });
      expect(tracker.size).toBe(1);
      tracker.add({ label: "b", fn: async () => {} });
      expect(tracker.size).toBe(2);
    });
  });
});
