import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ui } from "../../../src/utils/ui";

describe("ui theme constants", () => {
  describe("badges", () => {
    it("ERROR badge contains ERROR text", () => {
      expect(ui.badges.ERROR).toContain("ERROR");
    });

    it("ROLLBACK badge contains ROLLBACK text", () => {
      expect(ui.badges.ROLLBACK).toContain("ROLLBACK");
    });

    it("badge() creates a badge with custom text", () => {
      const result = ui.badge("TypeError");
      expect(result).toContain("TypeError");
    });
  });

  describe("labels", () => {
    it("WARNING label contains WARNING text", () => {
      expect(ui.labels.WARNING).toContain("WARNING");
    });

    it("NOTE label contains NOTE text", () => {
      expect(ui.labels.NOTE).toContain("NOTE");
    });

    it("INFO label contains INFO text", () => {
      expect(ui.labels.INFO).toContain("INFO");
    });

    it("SUCCESS label contains SUCCESS text", () => {
      expect(ui.labels.SUCCESS).toContain("SUCCESS");
    });

    it("HINT label contains HINT text", () => {
      expect(ui.labels.HINT).toContain("HINT");
    });

    it("DRY_RUN label contains dry-run text", () => {
      expect(ui.labels.DRY_RUN).toContain("dry-run");
    });
  });
});

describe("ui output functions", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("success() writes to stdout", () => {
    ui.success("done");
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0][0]).toContain("done");
  });

  it("info() writes to stdout", () => {
    ui.info("scanning");
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0][0]).toContain("scanning");
  });

  it("warn() writes to stderr", () => {
    ui.warn("caution");
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toContain("caution");
  });

  it("error() writes to stderr", () => {
    ui.error("failed");
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toContain("failed");
  });

  it("hint() writes to stdout", () => {
    ui.hint("try this");
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0][0]).toContain("try this");
  });

  it("debug() does not output when DEBUG is unset", () => {
    const origDebug = process.env.DEBUG;
    delete process.env.DEBUG;
    ui.debug("hidden");
    expect(errorSpy).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
    if (origDebug !== undefined) process.env.DEBUG = origDebug;
  });

  it("debug() outputs when DEBUG=pubm", () => {
    const origDebug = process.env.DEBUG;
    process.env.DEBUG = "pubm";
    ui.debug("visible");
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toContain("visible");
    if (origDebug !== undefined) process.env.DEBUG = origDebug;
    else delete process.env.DEBUG;
  });
});

describe("link", () => {
  it("produces OSC 8 hyperlink escape sequence", () => {
    const result = ui.link("click", "https://example.com");
    expect(result).toBe(
      "\u001B]8;;https://example.com\u0007click\u001B]8;;\u0007",
    );
  });
});

describe("isDebug", () => {
  it("returns true when DEBUG=pubm", () => {
    const orig = process.env.DEBUG;
    process.env.DEBUG = "pubm";
    expect(ui.isDebug()).toBe(true);
    if (orig !== undefined) process.env.DEBUG = orig;
    else delete process.env.DEBUG;
  });

  it("returns false when DEBUG is unset", () => {
    const orig = process.env.DEBUG;
    delete process.env.DEBUG;
    expect(ui.isDebug()).toBe(false);
    if (orig !== undefined) process.env.DEBUG = orig;
  });
});

describe("formatNote", () => {
  it("formats hint note with emoji and label", () => {
    const result = ui.formatNote("hint", "use patch");
    expect(result).toContain("\u{1F4A1}");
    expect(result).toContain("Hint:");
    expect(result).toContain("use patch");
  });

  it("formats suggest note with emoji and label", () => {
    const result = ui.formatNote("suggest", "try minor");
    expect(result).toContain("\u{1F4E6}");
    expect(result).toContain("Suggest:");
    expect(result).toContain("try minor");
  });

  it("formats warning note with emoji and label", () => {
    const result = ui.formatNote("warning", "already published");
    expect(result).toContain("\u26A0");
    expect(result).toContain("Warning:");
    expect(result).toContain("already published");
  });
});
