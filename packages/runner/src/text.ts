import { inspect, stripVTControlCharacters, styleText } from "node:util";

const ESC = "\\u001B";
const C1 = "\\u009B";
const BEL = "\\u0007";
const STRING_TERMINATOR = "\\u001B\\\\";

const CLEAR_LINE_PATTERN = new RegExp(
  `(?:${ESC}|${C1})[[\\]=><~/#&.:=?%@~_-]*[0-9]*[a-ln-tqyz=><~/#&.:=?%@~_-]+`,
  "gim",
);
const BELL_PATTERN = new RegExp(BEL, "gim");
const OSC8_PATTERN = new RegExp(
  `${ESC}]8;;.*?(?:${BEL}|${STRING_TERMINATOR})(.*?)${ESC}]8;;(?:${BEL}|${STRING_TERMINATOR})`,
  "g",
);

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
    String(value)
      .replace(OSC8_PATTERN, "$1")
      .replace(CLEAR_LINE_PATTERN, "")
      .replace(BELL_PATTERN, ""),
  );
}

export function wrapTerminalLine(value: string, columns: number): string[] {
  if (!Number.isFinite(columns) || columns <= 0) return [value];

  const clean = stripTerminalControls(value);
  if (clean.length <= columns) return [value];

  const lines: string[] = [];
  let remaining = clean;
  while (remaining.length > columns) {
    lines.push(remaining.slice(0, columns));
    remaining = remaining.slice(columns);
  }
  if (remaining) lines.push(remaining);
  return lines;
}

export type ColorName = keyof typeof inspect.colors;

export const color = Object.fromEntries(
  Object.keys(inspect.colors).map((name) => [
    name,
    (value: unknown) =>
      process.env.NO_COLOR
        ? String(value)
        : styleText(name as ColorName, String(value)),
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
