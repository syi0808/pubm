import chalk from "chalk";
import { t } from "../i18n/index.js";

// --- Theme constants ---

function badge(text: string): string {
  return chalk.bgRed.white.bold(` ${text} `);
}

const badges = {
  ERROR: badge(t("label.error")),
  ROLLBACK: badge(t("label.rollback")),
} as const;

const labels = {
  WARNING: chalk.yellow.bold(t("label.warning")),
  NOTE: chalk.blue.bold(t("label.note")),
  INFO: chalk.cyan(t("label.info")),
  SUCCESS: chalk.green.bold(t("label.success")),
  HINT: chalk.magenta(t("label.hint")),
  DRY_RUN: chalk.gray.bold(t("label.dryRun")),
} as const;

// --- Helpers ---

function isDebug(): boolean {
  return process.env.DEBUG === "pubm";
}

function link(text: string, url: string): string {
  return `\u001B]8;;${url}\u0007${text}\u001B]8;;\u0007`;
}

type NoteType = "hint" | "suggest" | "warning";

const noteConfig: Record<
  NoteType,
  { emoji: string; label: string; style: (s: string) => string }
> = {
  hint: {
    emoji: "\u{1F4A1}",
    label: t("label.noteHint"),
    style: chalk.magenta,
  },
  suggest: {
    emoji: "\u{1F4E6}",
    label: t("label.noteSuggest"),
    style: chalk.blue,
  },
  warning: {
    emoji: "\u26A0",
    label: t("label.noteWarning"),
    style: chalk.yellow,
  },
};

function formatNote(type: NoteType, message: string): string {
  const cfg = noteConfig[type];
  return `${cfg.emoji} ${cfg.style(cfg.label)} ${message}`;
}

// --- Output functions ---

function success(message: string): void {
  console.log(`${chalk.green("\u2713")} ${message}`);
}

function info(message: string): void {
  console.log(`${labels.INFO} ${message}`);
}

function warn(message: string): void {
  console.error(`${labels.WARNING} ${message}`);
}

function error(message: string): void {
  console.error(`${badges.ERROR} ${message}`);
}

function hint(message: string): void {
  console.log(formatNote("hint", message));
}

function debug(message: string): void {
  if (!isDebug()) return;
  console.error(`${chalk.gray("DEBUG")} ${message}`);
}

export const ui = {
  badge,
  badges,
  labels,
  chalk,
  success,
  info,
  warn,
  error,
  hint,
  debug,
  link,
  isDebug,
  formatNote,
} as const;
