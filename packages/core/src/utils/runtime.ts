export type Runtime = "node" | "bun";

export function detectRuntime(): Runtime {
  if (typeof (globalThis as Record<string, unknown>).Bun !== "undefined") {
    return "bun";
  }
  return "node";
}

export function isBun(): boolean {
  return detectRuntime() === "bun";
}
