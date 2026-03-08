import { color } from "listr2";
import { NonZeroExitError } from "tinyexec";

export class AbstractError extends Error {
  cause?: unknown;

  constructor(message: string, { cause }: { cause?: unknown } = {}) {
    // @ts-expect-error
    super(message, { cause });

    this.cause = cause;
  }
}

function replaceCode(code: string): string {
  return code.replace(/`([^`].+)`/g, color.bold(color.underline("$1")));
}

function formatStderr(stderr: string): string {
  return stderr
    .split("\n")
    .map((line) => `  ${color.dim("│")} ${line}`)
    .join("\n");
}

function isNoisyCause(cause: unknown): boolean {
  if (cause instanceof NonZeroExitError) return true;
  if (
    cause instanceof Error &&
    /Process exited with non-zero status/i.test(cause.message)
  )
    return true;
  return false;
}

function formatError(error: AbstractError | string): string {
  if (!(error instanceof Error)) return `${error}`;

  const rawMessage =
    typeof error.message === "string"
      ? error.message
      : /* v8 ignore next */ String(error);

  // Split message into summary + stderr detail
  const newlineIndex = rawMessage.indexOf("\n");
  let summary: string;
  let detail: string | undefined;

  if (newlineIndex !== -1) {
    summary = rawMessage.slice(0, newlineIndex);
    detail = rawMessage.slice(newlineIndex + 1);
  } else {
    summary = rawMessage;
  }

  let result = `${color.bgRed(` ${error.name} `)}${color.reset("")} ${replaceCode(summary)}\n`;

  if (detail) {
    result += `\n${formatStderr(detail)}\n`;
  }

  // Stack trace only in debug mode
  if (process.env.DEBUG === "pubm" && error.stack) {
    result += error.stack
      .split("\n")
      .slice(1)
      .join("\n")
      .replace(/at/g, color.dim("at"))
      .replace(/\(([^(].+)\)/g, `(${color.blue("$1")})`);
  }

  // Show cause only if meaningful
  if (error.cause && !isNoisyCause(error.cause)) {
    const causeMsg =
      error.cause instanceof Error ? error.cause.message : String(error.cause);
    if (causeMsg !== summary) {
      result += `\n${color.dim("Caused by:")} `;
      result += formatError(error.cause as AbstractError);
    }
  }

  return result;
}

export function consoleError(error: string | Error): void {
  let errorText = "\n";

  if (typeof error === "string") {
    errorText += replaceCode(error);
  } else if (error instanceof Error) {
    errorText += formatError(error);
  } else {
    errorText += error;
  }

  console.error(`${errorText}\n`);
}
