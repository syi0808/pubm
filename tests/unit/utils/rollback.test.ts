import { beforeEach, describe, expect, it, vi } from "vitest";

let addRollback: typeof import("../../../src/utils/rollback.js").addRollback;
let rollback: typeof import("../../../src/utils/rollback.js").rollback;

beforeEach(async () => {
  vi.resetModules();
  const mod = await import("../../../src/utils/rollback.js");
  addRollback = mod.addRollback;
  rollback = mod.rollback;
});

describe("addRollback", () => {
  it("adds functions to the rollback queue", async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    const ctx = { id: 1 };

    addRollback(fn, ctx);
    await rollback();

    expect(fn).toHaveBeenCalledOnce();
  });
});

describe("rollback", () => {
  it("executes all queued rollbacks with correct context", async () => {
    const ctx1 = { name: "first" };
    const ctx2 = { name: "second" };
    const fn1 = vi.fn().mockResolvedValue(undefined);
    const fn2 = vi.fn().mockResolvedValue(undefined);

    addRollback(fn1, ctx1);
    addRollback(fn2, ctx2);

    await rollback();

    expect(fn1).toHaveBeenCalledWith(ctx1);
    expect(fn2).toHaveBeenCalledWith(ctx2);
  });

  it('logs "Rollback..." and "Rollback completed"', async () => {
    const spy = vi.spyOn(console, "log");
    const fn = vi.fn().mockResolvedValue(undefined);

    addRollback(fn, {});
    await rollback();

    expect(spy).toHaveBeenCalledWith("Rollback...");
    expect(spy).toHaveBeenCalledWith("Rollback completed");
  });

  it("is idempotent — second call is a no-op and does not log again", async () => {
    const spy = vi.spyOn(console, "log");
    const fn = vi.fn().mockResolvedValue(undefined);

    addRollback(fn, {});
    await rollback();

    spy.mockClear();
    fn.mockClear();

    await rollback();

    expect(fn).not.toHaveBeenCalled();
    expect(spy).not.toHaveBeenCalled();
  });

  it("does nothing when queue is empty (no logs)", async () => {
    const spy = vi.spyOn(console, "log");

    await rollback();

    expect(spy).not.toHaveBeenCalled();
  });

  it("continues executing remaining rollbacks when one throws", async () => {
    const fn1 = vi.fn().mockRejectedValue(new Error("fn1 failed"));
    const fn2 = vi.fn().mockResolvedValue(undefined);
    const fn3 = vi.fn().mockResolvedValue(undefined);

    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});

    addRollback(fn1, {});
    addRollback(fn2, {});
    addRollback(fn3, {});

    await rollback();

    expect(fn1).toHaveBeenCalledOnce();
    expect(fn2).toHaveBeenCalledOnce();
    expect(fn3).toHaveBeenCalledOnce();
  });

  it("logs failed rollback operations", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});

    const fn = vi.fn().mockRejectedValue(new Error("disk full"));

    addRollback(fn, {});
    await rollback();

    expect(errorSpy).toHaveBeenCalledWith(
      "Rollback operation failed: disk full",
    );
  });

  it("logs partial completion message when some rollbacks fail", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    const fn1 = vi.fn().mockRejectedValue(new Error("oops"));
    const fn2 = vi.fn().mockResolvedValue(undefined);

    addRollback(fn1, {});
    addRollback(fn2, {});

    await rollback();

    expect(logSpy).toHaveBeenCalledWith(
      "Rollback completed with errors. Some operations may require manual recovery.",
    );
  });

  it("executes multiple rollbacks concurrently via Promise.all", async () => {
    const order: number[] = [];

    const fn1 = vi.fn(async () => {
      order.push(1);
    });
    const fn2 = vi.fn(async () => {
      order.push(2);
    });
    const fn3 = vi.fn(async () => {
      order.push(3);
    });

    addRollback(fn1, {});
    addRollback(fn2, {});
    addRollback(fn3, {});

    await rollback();

    expect(fn1).toHaveBeenCalledOnce();
    expect(fn2).toHaveBeenCalledOnce();
    expect(fn3).toHaveBeenCalledOnce();
    expect(order).toHaveLength(3);
    expect(order).toContain(1);
    expect(order).toContain(2);
    expect(order).toContain(3);
  });
});
