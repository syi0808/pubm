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
        "\u001B]8;id=docs;https://example.com\u001B\\Label\u001B]8;;\u001B\\\u0007",
      ),
    ).toBe("Label");
    expect(normalizeTerminalText("\u001b[2Kready")).toBe("ready");
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
    const wrapped = wrapTerminalLine("\u001b[32mabcdef\u001b[39m", 3);

    expect(wrapped.join("")).toBe("\u001b[32mabcdef\u001b[39m");
    expect(wrapped.map(normalizeTerminalText)).toEqual(["abc", "def"]);
    expect(wrapTerminalLine("short", 80)).toEqual(["short"]);
  });

  it("counts tab characters when wrapping terminal lines", () => {
    const wrapped = wrapTerminalLine("ab\tc", 3);

    expect(wrapped).toEqual(["ab\t", "c"]);
  });

  it("wraps around terminal controls without counting them as columns", () => {
    const hyperlink =
      "\u001b]8;;https://example.com\u0007abcdef\u001b]8;;\u0007";

    expect(wrapTerminalLine("text", 0)).toEqual(["text"]);
    const wrappedHyperlink = wrapTerminalLine(`\u0007${hyperlink}`, 3);
    expect(wrappedHyperlink).toHaveLength(2);
    expect(normalizeTerminalText(wrappedHyperlink.join(""))).toBe("abcdef");
    expect(
      normalizeTerminalText(
        wrapTerminalLine(
          "\u001b]8;;https://example.com\u001b\\abcdef\u001b]8;;\u001b\\",
          3,
        ).join(""),
      ),
    ).toBe("abcdef");
    expect(
      wrapTerminalLine("\u009B32mabcdef\u009B39m", 3).map(
        normalizeTerminalText,
      ),
    ).toEqual(["abc", "def"]);
    const wrappedUnknownEscape = wrapTerminalLine("\u001bxabcdef", 3);
    expect(wrappedUnknownEscape).toHaveLength(2);
    expect(wrappedUnknownEscape.join("")).toBe("\u001bxabcdef");
    const wrappedCharsetEscape = wrapTerminalLine("\u001b(Babcdef", 3);
    expect(wrappedCharsetEscape.join("")).toBe("\u001b(Babcdef");
    expect(wrappedCharsetEscape.map(normalizeTerminalText)).toEqual([
      "abc",
      "def",
    ]);
  });

  it("wraps non-ASCII text by terminal display width", () => {
    expect(wrapTerminalLine("語語a", 4)).toEqual(["語語", "a"]);

    const wrapped = wrapTerminalLine("\u001b[32m語語a\u001b[39m", 4);

    expect(wrapped.join("")).toBe("\u001b[32m語語a\u001b[39m");
    expect(wrapped.map(normalizeTerminalText)).toEqual(["語語", "a"]);
  });

  it("counts common wide and zero-width Unicode ranges", () => {
    const wideSamples = [
      String.fromCodePoint(0x1100),
      String.fromCodePoint(0x2329),
      "가",
      String.fromCodePoint(0xf900),
      String.fromCodePoint(0xfe19),
      String.fromCodePoint(0xfe30),
      String.fromCodePoint(0xff21),
      String.fromCodePoint(0xffe6),
      "😀",
      "🚀",
      "🧪",
      String.fromCodePoint(0x1fa70),
      String.fromCodePoint(0x20000),
    ];

    for (const char of wideSamples) {
      expect(wrapTerminalLine(`${char}${char}a`, 4)).toEqual([
        `${char}${char}`,
        "a",
      ]);
    }

    expect(wrapTerminalLine("a\u200bb", 2)).toEqual(["a\u200bb"]);
    expect(wrapTerminalLine("a\ufe0fb", 2)).toEqual(["a\ufe0fb"]);
    expect(wrapTerminalLine("e\u0301", 1)).toEqual(["e\u0301"]);
  });
});
