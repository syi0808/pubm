import process from "node:process";
import { describe, expect, it, vi } from "vitest";
import { ProcessSignalController } from "../../../src/workflow/process-signal-controller.js";

function countSigintListener(handler: () => void): number {
  return process
    .rawListeners("SIGINT")
    .filter((listener) => listener === handler).length;
}

describe("ProcessSignalController", () => {
  it("keeps the active remover disposable after a stale remover is called", () => {
    const controller = new ProcessSignalController();
    const first = vi.fn();
    const second = vi.fn();

    const removeFirst = controller.onInterrupt(first);
    const removeSecond = controller.onInterrupt(second);

    removeFirst();
    controller.dispose();

    expect(countSigintListener(first)).toBe(0);
    expect(countSigintListener(second)).toBe(0);

    removeSecond();
  });
});
