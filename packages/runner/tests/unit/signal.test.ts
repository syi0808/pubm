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
});
