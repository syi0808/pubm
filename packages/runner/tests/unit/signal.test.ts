import { describe, expect, it, vi } from "vitest";
import { ProcessSignalController } from "../../src/signal.js";

describe("ProcessSignalController", () => {
  it("registers one-shot process handlers and removes remaining listeners on dispose", () => {
    const controller = new ProcessSignalController();
    const interrupt = vi.fn();
    const terminate = vi.fn();

    controller.onInterrupt(interrupt);
    controller.onTerminate(terminate);

    process.emit("SIGINT");
    process.emit("SIGINT");

    expect(interrupt).toHaveBeenCalledTimes(1);
    expect(interrupt).toHaveBeenCalledWith("SIGINT");

    controller.dispose();
    process.emit("SIGTERM");

    expect(terminate).not.toHaveBeenCalled();
  });

  it("handles sync throws and async rejections from process signal handlers", async () => {
    const throwingController = new ProcessSignalController();
    const rejectingController = new ProcessSignalController();

    throwingController.onInterrupt(() => {
      throw new Error("sync failure");
    });
    rejectingController.onTerminate(async () => {
      throw new Error("async failure");
    });

    expect(() => process.emit("SIGINT")).not.toThrow();
    process.emit("SIGTERM");
    await new Promise((resolve) => setImmediate(resolve));

    throwingController.dispose();
    rejectingController.dispose();
  });
});
