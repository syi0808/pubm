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
      void handler(signal);
    };
    process.once(signal, listener);
    this.disposers.push(() => {
      process.removeListener(signal, listener);
    });
  }
}
