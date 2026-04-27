import type { SingleFlightRegistry } from "./types.js";

export class InMemorySingleFlightRegistry implements SingleFlightRegistry {
  private readonly pending = new Map<string, Promise<unknown>>();

  run<T>(key: string, run: () => Promise<T>): Promise<T> {
    const existing = this.pending.get(key);
    if (existing) return existing as Promise<T>;

    const promise = run().finally(() => {
      if (this.pending.get(key) === promise) {
        this.pending.delete(key);
      }
    });
    this.pending.set(key, promise);
    return promise;
  }

  clear(key?: string): void {
    if (key) {
      this.pending.delete(key);
      return;
    }

    this.pending.clear();
  }
}
