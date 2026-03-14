import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockCheckUpdateStatus } = vi.hoisted(() => ({
  mockCheckUpdateStatus: vi.fn(),
}));

vi.mock("@pubm/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@pubm/core")>();
  return {
    ...actual,
    checkUpdateStatus: mockCheckUpdateStatus,
  };
});

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

describe("showSplashWithUpdateCheck", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows Ready when no update available", async () => {
    mockCheckUpdateStatus.mockResolvedValue({
      kind: "up-to-date",
      current: "1.0.0",
    });

    const { showSplashWithUpdateCheck } = await import("../../src/splash.js");
    const promise = showSplashWithUpdateCheck("1.0.0");
    await vi.runAllTimersAsync();
    await promise;

    const output = stderrSpy.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("✓");
    expect(output).toContain("Ready");
  });

  it("shows update available message when update exists", async () => {
    mockCheckUpdateStatus.mockResolvedValue({
      kind: "available",
      current: "1.0.0",
      latest: "2.0.0",
    });

    const { showSplashWithUpdateCheck } = await import("../../src/splash.js");
    const promise = showSplashWithUpdateCheck("1.0.0");
    await vi.runAllTimersAsync();
    await promise;

    const output = stderrSpy.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("✓");
    expect(output).toContain("2.0.0");
  });

  it("shows Ready when check fails", async () => {
    mockCheckUpdateStatus.mockResolvedValue(undefined);

    const { showSplashWithUpdateCheck } = await import("../../src/splash.js");
    const promise = showSplashWithUpdateCheck("1.0.0");
    await vi.runAllTimersAsync();
    await promise;

    const output = stderrSpy.mock.calls.map((c) => c[0]).join("");
    expect(output).toContain("✓");
    expect(output).toContain("Ready");
  });
});
