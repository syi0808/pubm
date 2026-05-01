import process from "node:process";
import type { SignalController, SignalHandler } from "./types.js";

export class ProcessSignalController implements SignalController {
  private removeInterruptListener: (() => void) | undefined;

  onInterrupt(handler: SignalHandler): () => void {
    this.removeInterruptListener?.();
    process.on("SIGINT", handler);
    const removeListener = () => {
      process.removeListener("SIGINT", handler);
      if (this.removeInterruptListener === removeListener) {
        this.removeInterruptListener = undefined;
      }
    };
    this.removeInterruptListener = removeListener;
    return this.removeInterruptListener;
  }

  dispose(): void {
    this.removeInterruptListener?.();
  }
}
