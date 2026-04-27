import { inspect, stripVTControlCharacters } from "node:util";
import * as nodeUtil from "node:util";

const BEL = "\\u0007";

const styleTerminalText =
  typeof nodeUtil.styleText === "function"
    ? nodeUtil.styleText
    : (_name: string, value: string) => value;
const OSC8_PATTERN =
  /\u001B]8;[^;\u0007]*(?:;[^\u0007\u001B]*)?(?:\u0007|\u001B\\)(.*?)\u001B]8;[^;\u0007]*(?:;[^\u0007\u001B]*)?(?:\u0007|\u001B\\)/g;
const BELL_PATTERN = new RegExp(BEL, "gim");

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

export function normalizeTerminalText(value: unknown): string {
  return stripTerminalControls(value).trim();
}

export function stripTerminalControls(value: unknown): string {
  return stripVTControlCharacters(
    String(value).replace(OSC8_PATTERN, "$1").replace(BELL_PATTERN, ""),
  );
}

export function wrapTerminalLine(value: string, columns: number): string[] {
  if (!Number.isFinite(columns) || columns <= 0) return [value];

  const clean = stripTerminalControls(value);
  if (clean.length <= columns) return [value];

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
      codePoint === undefined
        ? value[index]
        : String.fromCodePoint(codePoint);
    if (!char) break;

    current += char;
    currentColumns += stripTerminalControls(char).length;
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

  if (char !== "\u001B") return undefined;

  const marker = value[index + 1];
  if (marker === "[") return csiEnd(value, index + 2);
  if (marker === "]") return oscEnd(value, index + 2);
  return escapeEnd(value, index + 1);
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
      codePoint === undefined
        ? value[cursor]
        : String.fromCodePoint(codePoint);
    if (!char) return false;
    if (stripTerminalControls(char).length > 0) return true;
    cursor += char.length;
  }
  return false;
}

export type ColorName = keyof typeof inspect.colors;

export const color = Object.fromEntries(
  Object.keys(inspect.colors).map((name) => [
    name,
    (value: unknown) =>
      process.env.NO_COLOR
        ? String(value)
        : styleTerminalText(name as ColorName, String(value)),
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
