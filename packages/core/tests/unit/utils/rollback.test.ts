import { beforeEach, describe, expect, it, vi } from "vitest";

let addRollback: typeof import("../../../src/utils/rollback.js").addRollback;
let rollback: typeof import("../../../src/utils/rollback.js").rollback;
let rollbackLog: typeof import("../../../src/utils/rollback.js").rollbackLog;
let rollbackError: typeof import("../../../src/utils/rollback.js").rollbackError;

beforeEach(async () => {
  vi.resetModules();
  const mod = await import("../../../src/utils/rollback.js");
  addRollback = mod.addRollback;
  rollback = mod.rollback;
  rollbackLog = mod.rollbackLog;
  rollbackError = mod.rollbackError;
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

  it("logs styled rollback start and completion", async () => {
    const spy = vi.spyOn(console, "log");
    const fn = vi.fn().mockResolvedValue(undefined);

    addRollback(fn, {});
    await rollback();

    const startCall = spy.mock.calls.find((c) =>
      (c[0] as string).includes("Rolling back"),
    );
    const doneCall = spy.mock.calls.find((c) =>
      (c[0] as string).includes("Rollback completed"),
    );
    expect(startCall).toBeDefined();
    expect(doneCall).toBeDefined();
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

  it("logs styled failed rollback operations", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});

    const fn = vi.fn().mockRejectedValue(new Error("disk full"));

    addRollback(fn, {});
    await rollback();

    const failCall = errorSpy.mock.calls.find((c) =>
      (c[0] as string).includes("disk full"),
    );
    expect(failCall).toBeDefined();
  });

  it("logs styled error completion message when some rollbacks fail", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    const fn1 = vi.fn().mockRejectedValue(new Error("oops"));
    const fn2 = vi.fn().mockResolvedValue(undefined);

    addRollback(fn1, {});
    addRollback(fn2, {});

    await rollback();

    const errorCompletion = logSpy.mock.calls.find((c) =>
      (c[0] as string).includes("Rollback completed with errors"),
    );
    expect(errorCompletion).toBeDefined();
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

describe("rollbackLog", () => {
  it("logs sub-operation with arrow prefix", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    rollbackLog("Deleting tag");

    const output = spy.mock.calls[0][0] as string;
    expect(output).toContain("↩");
    expect(output).toContain("Deleting tag");
  });
});

describe("rollbackError", () => {
  it("logs error with cross prefix", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    rollbackError("Failed to delete tag");

    const output = spy.mock.calls[0][0] as string;
    expect(output).toContain("✗");
    expect(output).toContain("Failed to delete tag");
  });
});
