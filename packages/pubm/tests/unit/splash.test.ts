import { beforeEach, describe, expect, it, vi } from "vitest";

let stderrSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

describe("showSplash", () => {
  it("writes ASCII art logo to stderr", async () => {
    const { showSplash } = await import("../../src/splash.js");

    showSplash("1.0.0");

    const output = stderrSpy.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("pubm");
  });

  it("includes version in output", async () => {
    const { showSplash } = await import("../../src/splash.js");

    showSplash("1.2.3");

    const output = stderrSpy.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("1.2.3");
  });
});
