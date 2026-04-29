import * as nodeUtil from "node:util";
import { inspect, stripVTControlCharacters } from "node:util";

const ESC = "\\u001B";
const BEL = "\\u0007";

const styleTerminalText =
  typeof nodeUtil.styleText === "function"
    ? nodeUtil.styleText
    : (_name: string, value: string) => value;
const OSC8_PARAMS = `[^;${BEL}]*(?:;[^${BEL}${ESC}]*)?`;
const OSC8_TERMINATOR = `(?:${BEL}|${ESC}\\\\)`;
const OSC8_PATTERN = new RegExp(
  `${ESC}\\]8;${OSC8_PARAMS}${OSC8_TERMINATOR}(.*?)${ESC}\\]8;${OSC8_PARAMS}${OSC8_TERMINATOR}`,
  "g",
);
const BELL_PATTERN = new RegExp(BEL, "gim");
const MARK_PATTERN = /\p{Mark}/u;

export const figures = {
  main: {
    warning: "⚠",
    cross: "✖",
    arrowDown: "↓",
    tick: "✔",
    arrowRight: "→",
    pointer: "❯",
    checkboxOn: "☒",
    arrowLeft: "←",
    squareSmallFilled: "◼",
    pointerSmall: "›",
    spinnerFrames: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
  },
  fallback: {
    warning: "‼",
    cross: "×",
    arrowDown: "↓",
    tick: "√",
    arrowRight: "→",
    pointer: ">",
    checkboxOn: "[×]",
    arrowLeft: "←",
    squareSmallFilled: "■",
    pointerSmall: "›",
    spinnerFrames: ["-", "\\", "|", "/"],
  },
} as const;

export function isUnicodeSupported(): boolean {
  return (
    !!process.env.FORCE_UNICODE ||
    !!process.env.LISTR_FORCE_UNICODE ||
    process.platform !== "win32" ||
    !!process.env.CI ||
    !!process.env.WT_SESSION ||
    process.env.TERM_PROGRAM === "vscode" ||
    process.env.TERM === "xterm-256color" ||
    process.env.TERM === "alacritty"
  );
}

export function terminalFigures(): Record<
  Exclude<keyof (typeof figures)["main"], "spinnerFrames">,
  string
> {
  return isUnicodeSupported() ? figures.main : figures.fallback;
}

export function terminalSpinnerFrames(): readonly string[] {
  return isUnicodeSupported()
    ? figures.main.spinnerFrames
    : figures.fallback.spinnerFrames;
}

export function shouldUseColor(useColor = true): boolean {
  return useColor && !process.env.NO_COLOR;
}

export function normalizeTerminalText(value: unknown): string {
  return stripTerminalControls(value).trim();
}

export function normalizeTerminalDisplayText(
  value: unknown,
  useColor = true,
  preserveLinks = true,
): string {
  const sanitized = stripTerminalControls(value, {
    preserveLinks,
    preserveStyle: shouldUseColor(useColor),
  });
  return normalizeTerminalText(sanitized) ? sanitized.trim() : "";
}

export function stripTerminalControls(
  value: unknown,
  options: { preserveLinks?: boolean; preserveStyle?: boolean } = {},
): string {
  const normalized = String(value);
  if (!options.preserveLinks && !options.preserveStyle) {
    const withoutHyperlinkControls = normalized.replace(OSC8_PATTERN, "$1");
    return stripVTControlCharacters(withoutHyperlinkControls).replace(
      BELL_PATTERN,
      "",
    );
  }
  return stripTerminalControlsPreservingDisplay(normalized, options);
}

export function wrapTerminalLine(value: string, columns: number): string[] {
  if (!Number.isFinite(columns) || columns <= 0) return [value];

  const clean = stripTerminalControls(value);
  if (stringDisplayWidth(clean) <= columns) return [value];

  const lines: string[] = [];
  let current = "";
  let currentColumns = 0;
  for (let index = 0; index < value.length; ) {
    const controlEnd = terminalControlEnd(value, index);
    if (controlEnd !== undefined) {
      current += value.slice(index, controlEnd);
      index = controlEnd;
      continue;
    }

    const codePoint = value.codePointAt(index);
    const char =
      codePoint === undefined ? value[index] : String.fromCodePoint(codePoint);
    if (!char) break;

    current += char;
    currentColumns += stringDisplayWidth(stripTerminalControls(char));
    index += char.length;

    if (currentColumns >= columns && hasVisibleText(value, index)) {
      lines.push(current);
      current = "";
      currentColumns = 0;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function terminalControlEnd(value: string, index: number): number | undefined {
  const char = value[index];
  if (char === "\u0007") return index + 1;

  if (char === "\u009B") {
    return csiEnd(value, index + 1);
  }
  if (char === "\u009D") {
    return oscEnd(value, index + 1);
  }

  if (char !== "\u001B") return undefined;

  const marker = value[index + 1];
  if (marker === "[") return csiEnd(value, index + 2);
  if (marker === "]") return oscEnd(value, index + 2);
  return escapeEnd(value, index + 1);
}

function stripTerminalControlsPreservingDisplay(
  value: string,
  options: { preserveLinks?: boolean; preserveStyle?: boolean },
): string {
  let result = "";
  for (let index = 0; index < value.length; ) {
    const char = value[index] ?? "";

    if (char === "\u009B") {
      const end = csiEnd(value, index + 1);
      if (options.preserveStyle && isSafeSgrSequence(value, index + 1, end)) {
        result += value.slice(index, end);
      }
      index = end;
      continue;
    }

    if (char === "\u009D") {
      const end = oscEnd(value, index + 1);
      if (options.preserveLinks && isSafeOsc8Sequence(value, index + 1, end)) {
        result += value.slice(index, end);
      }
      index = end;
      continue;
    }

    if (char === "\u001B") {
      const marker = value[index + 1];
      if (marker === "[") {
        const end = csiEnd(value, index + 2);
        if (options.preserveStyle && isSafeSgrSequence(value, index + 2, end)) {
          result += value.slice(index, end);
        }
        index = end;
        continue;
      }
      if (marker === "]") {
        const end = oscEnd(value, index + 2);
        if (
          options.preserveLinks &&
          isSafeOsc8Sequence(value, index + 2, end)
        ) {
          result += value.slice(index, end);
        }
        index = end;
        continue;
      }
      index = escapeEnd(value, index + 1);
      continue;
    }

    const code = char.charCodeAt(0);
    if (
      (code < 0x20 && char !== "\n" && char !== "\r" && char !== "\t") ||
      (code >= 0x7f && code <= 0x9f)
    ) {
      index += 1;
      continue;
    }

    result += char;
    index += 1;
  }
  return result;
}

function isSafeOsc8Sequence(
  value: string,
  payloadStart: number,
  end: number,
): boolean {
  const payload = oscPayload(value, payloadStart, end);
  if (payload === undefined) return false;
  return isSafeOsc8Payload(payload);
}

function oscPayload(
  value: string,
  payloadStart: number,
  end: number,
): string | undefined {
  if (end <= payloadStart) return undefined;
  if (value[end - 1] === "\u0007") {
    return value.slice(payloadStart, end - 1);
  }
  if (value[end - 1] === "\\" && value[end - 2] === "\u001B") {
    return value.slice(payloadStart, end - 2);
  }
  return undefined;
}

function isSafeOsc8Payload(payload: string): boolean {
  if (!payload.startsWith("8;")) return false;
  if (payload.indexOf(";", 2) === -1) return false;
  return !hasControlCode(payload);
}

function hasControlCode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

function isSafeSgrSequence(
  value: string,
  paramsStart: number,
  end: number,
): boolean {
  if (end <= paramsStart) return false;
  if (value[end - 1] !== "m") return false;
  const params = value.slice(paramsStart, end - 1);
  return /^[0-9;:]*$/.test(params);
}

function escapeEnd(value: string, index: number): number {
  let cursor = index;
  while (cursor < value.length) {
    const code = value.charCodeAt(cursor);
    if (code < 0x20 || code > 0x2f) break;
    cursor += 1;
  }

  if (cursor >= value.length) return value.length;

  const finalCode = value.charCodeAt(cursor);
  if (finalCode >= 0x30 && finalCode <= 0x7e) return cursor + 1;
  return cursor;
}

function csiEnd(value: string, index: number): number {
  for (let cursor = index; cursor < value.length; cursor += 1) {
    const code = value.charCodeAt(cursor);
    if (code >= 0x40 && code <= 0x7e) return cursor + 1;
  }
  return value.length;
}

function oscEnd(value: string, index: number): number {
  for (let cursor = index; cursor < value.length; cursor += 1) {
    const char = value[cursor];
    if (char === "\u0007") return cursor + 1;
    if (char === "\\" && value[cursor - 1] === "\u001B") return cursor + 1;
  }
  return value.length;
}

function hasVisibleText(value: string, index: number): boolean {
  for (let cursor = index; cursor < value.length; ) {
    const controlEnd = terminalControlEnd(value, cursor);
    if (controlEnd !== undefined) {
      cursor = controlEnd;
      continue;
    }

    const codePoint = value.codePointAt(cursor);
    const char =
      codePoint === undefined ? value[cursor] : String.fromCodePoint(codePoint);
    if (!char) return false;
    if (stringDisplayWidth(stripTerminalControls(char)) > 0) return true;
    cursor += char.length;
  }
  return false;
}

function stringDisplayWidth(value: string): number {
  let width = 0;
  for (let index = 0; index < value.length; ) {
    const codePoint = value.codePointAt(index);
    const char =
      codePoint === undefined ? value[index] : String.fromCodePoint(codePoint);
    if (!char || codePoint === undefined) break;

    if (!isZeroWidthCodePoint(codePoint, char)) {
      width += isWideCodePoint(codePoint) ? 2 : 1;
    }
    index += char.length;
  }
  return width;
}

function isZeroWidthCodePoint(codePoint: number, char: string): boolean {
  return (
    (codePoint <= 0x1f && codePoint !== 0x09) ||
    (codePoint >= 0x7f && codePoint <= 0x9f) ||
    codePoint === 0x00ad ||
    codePoint === 0x200b ||
    codePoint === 0x200c ||
    codePoint === 0x200d ||
    codePoint === 0xfeff ||
    (codePoint >= 0xfe00 && codePoint <= 0xfe0f) ||
    (codePoint >= 0xe0100 && codePoint <= 0xe01ef) ||
    MARK_PATTERN.test(char)
  );
}

function isWideCodePoint(codePoint: number): boolean {
  return (
    codePoint >= 0x1100 &&
    (codePoint <= 0x115f ||
      codePoint === 0x2329 ||
      codePoint === 0x232a ||
      (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f) ||
      (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
      (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
      (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
      (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
      (codePoint >= 0xff00 && codePoint <= 0xff60) ||
      (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
      (codePoint >= 0x1f300 && codePoint <= 0x1f5ff) ||
      (codePoint >= 0x1f600 && codePoint <= 0x1f64f) ||
      (codePoint >= 0x1f680 && codePoint <= 0x1f6ff) ||
      (codePoint >= 0x1f900 && codePoint <= 0x1f9ff) ||
      (codePoint >= 0x1fa70 && codePoint <= 0x1faff) ||
      (codePoint >= 0x20000 && codePoint <= 0x3fffd))
  );
}

export type ColorName = keyof typeof inspect.colors;

export const color = Object.fromEntries(
  Object.keys(inspect.colors).map((name) => [
    name,
    (value: unknown) =>
      shouldUseColor()
        ? styleTerminalText(name as ColorName, String(value))
        : String(value),
  ]),
) as Record<ColorName, (value: unknown) => string>;

export function splat(message: unknown, ...metadata: unknown[]): string {
  if (metadata.length === 0) return String(message);
  let index = 0;
  return String(message).replace(/%[sdijoO%]/g, (token) => {
    if (token === "%%") return "%";
    const value = metadata[index++];
    if (token === "%j") {
      try {
        return JSON.stringify(value);
      } catch {
        return "[Circular]";
      }
    }
    if (token === "%d") return Number(value).toString();
    return String(value);
  });
}
