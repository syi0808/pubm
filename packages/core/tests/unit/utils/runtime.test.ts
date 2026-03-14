import { describe, expect, it } from "vitest";
import { detectRuntime, isBun } from "../../../src/utils/runtime.js";

describe("detectRuntime", () => {
  it("should detect node runtime in Vitest", () => {
    const runtime = detectRuntime();
    expect(runtime).toBe("node");
  });

  it("isBun should return false in Node", () => {
    expect(isBun()).toBe(false);
  });

  it("detects bun runtime when Bun global is defined", () => {
    (globalThis as any).Bun = {};
    try {
      expect(detectRuntime()).toBe("bun");
      expect(isBun()).toBe(true);
    } finally {
      delete (globalThis as any).Bun;
    }
  });
});
