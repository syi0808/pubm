import { afterEach, describe, expect, it } from "vitest";
import {
  color,
  figures,
  isUnicodeSupported,
  normalizeTerminalText,
  splat,
  terminalFigures,
  wrapTerminalLine,
} from "../../src/text.js";

const ENV_KEYS = [
  "FORCE_UNICODE",
  "LISTR_FORCE_UNICODE",
  "CI",
  "WT_SESSION",
  "TERM_PROGRAM",
  "TERM",
  "NO_COLOR",
] as const;
const originalEnv = Object.fromEntries(
  ENV_KEYS.map((key) => [key, process.env[key]]),
);
const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");

function resetEnv(): void {
  for (const key of ENV_KEYS) {
    const value = originalEnv[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, "platform", {
    configurable: true,
    value: platform,
  });
}

afterEach(() => {
  resetEnv();
  if (originalPlatform) {
    Object.defineProperty(process, "platform", originalPlatform);
  }
});

describe("terminal text helpers", () => {
  it("normalizes OSC hyperlinks, ANSI controls, bells, and non-string values", () => {
    expect(
      normalizeTerminalText(
        "\u001B]8;;https://example.com\u001B\\Label\u001B]8;;\u001B\\\u0007",
      ),
    ).toBe("Label");
    expect(normalizeTerminalText(42)).toBe("42");
  });

  it("selects unicode and fallback figures for common terminal environments", () => {
    resetEnv();
    setPlatform("win32");
    for (const key of [
      "FORCE_UNICODE",
      "LISTR_FORCE_UNICODE",
      "CI",
      "WT_SESSION",
      "TERM_PROGRAM",
      "TERM",
    ] as const) {
      delete process.env[key];
    }

    expect(isUnicodeSupported()).toBe(false);
    expect(terminalFigures()).toBe(figures.fallback);

    process.env.FORCE_UNICODE = "1";
    expect(isUnicodeSupported()).toBe(true);
    delete process.env.FORCE_UNICODE;

    process.env.LISTR_FORCE_UNICODE = "1";
    expect(isUnicodeSupported()).toBe(true);
    delete process.env.LISTR_FORCE_UNICODE;

    process.env.CI = "1";
    expect(isUnicodeSupported()).toBe(true);
    delete process.env.CI;

    process.env.WT_SESSION = "1";
    expect(isUnicodeSupported()).toBe(true);
    delete process.env.WT_SESSION;

    process.env.TERM_PROGRAM = "vscode";
    expect(isUnicodeSupported()).toBe(true);
    delete process.env.TERM_PROGRAM;

    process.env.TERM = "xterm-256color";
    expect(isUnicodeSupported()).toBe(true);

    process.env.TERM = "alacritty";
    expect(isUnicodeSupported()).toBe(true);

    setPlatform("darwin");
    delete process.env.TERM;
    expect(isUnicodeSupported()).toBe(true);
    expect(terminalFigures()).toBe(figures.main);
  });

  it("formats colors unless NO_COLOR is set", () => {
    delete process.env.NO_COLOR;
    expect(normalizeTerminalText(color.red("danger"))).toBe("danger");

    process.env.NO_COLOR = "1";
    expect(color.red("danger")).toBe("danger");
  });

  it("supports listr-style splat formatting tokens", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(splat("plain")).toBe("plain");
    expect(
      splat("%% %s %d %j %o", "name", "7", { ok: true }, { nested: true }),
    ).toBe('% name 7 {"ok":true} [object Object]');
    expect(splat("%j %i", circular, 9)).toBe("[Circular] 9");
  });

  it("wraps long terminal lines after stripping control sequences", () => {
    expect(wrapTerminalLine("\u001b[32mabcdef\u001b[39m", 3)).toEqual([
      "abc",
      "def",
    ]);
    expect(wrapTerminalLine("short", 80)).toEqual(["short"]);
  });
});
