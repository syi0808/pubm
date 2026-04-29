import type { TaskEvent, TaskEventSource } from "./types.js";

export class EventSource implements TaskEventSource {
  private readonly listeners = new Set<(event: TaskEvent) => void>();

  subscribe(listener: (event: TaskEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(event: TaskEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}
