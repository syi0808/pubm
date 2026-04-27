import type { SignalController } from "./types.js";

type SignalHandler = (signal: NodeJS.Signals) => void | Promise<void>;

export class ProcessSignalController implements SignalController {
  private readonly disposers: (() => void)[] = [];

  onInterrupt(handler: SignalHandler): void {
    this.add("SIGINT", handler);
  }

  onTerminate(handler: SignalHandler): void {
    this.add("SIGTERM", handler);
  }

  dispose(): void {
    for (const dispose of this.disposers.splice(0)) {
      dispose();
    }
  }

  private add(signal: NodeJS.Signals, handler: SignalHandler): void {
    const listener = () => {
      try {
        void Promise.resolve(handler(signal)).catch(() => {});
      } catch {
        // Signal listeners cannot return failures to process.once.
      }
    };
    process.once(signal, listener);
    this.disposers.push(() => {
      process.removeListener(signal, listener);
    });
  }
}
