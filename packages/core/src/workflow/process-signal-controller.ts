import process from "node:process";
import type { SignalController, SignalHandler } from "./types.js";

export class ProcessSignalController implements SignalController {
  private removeInterruptListener: (() => void) | undefined;

  onInterrupt(handler: SignalHandler): () => void {
    this.removeInterruptListener?.();
    process.on("SIGINT", handler);
    this.removeInterruptListener = () => {
      process.removeListener("SIGINT", handler);
      this.removeInterruptListener = undefined;
    };
    return this.removeInterruptListener;
  }

  dispose(): void {
    this.removeInterruptListener?.();
  }
}
