import { spawn as nodeSpawn } from "node:child_process";

export class NonZeroExitError extends Error {
  output: { stdout: string; stderr: string };

  constructor(
    command: string,
    exitCode: number,
    output: { stdout: string; stderr: string },
  ) {
    super(
      `Command "${command}" exited with code ${exitCode}\n${output.stderr}`,
    );
    this.name = "NonZeroExitError";
    this.output = output;
  }
}

export interface ExecOptions {
  throwOnError?: boolean;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
  nodeOptions?: {
    env?: Record<string, string | undefined>;
    cwd?: string;
  };
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function getEnhancedPath(): string {
  const cwd = process.cwd();
  const pathSep = process.platform === "win32" ? ";" : ":";
  const binPath = `${cwd}/node_modules/.bin`;

  return `${binPath}${pathSep}${process.env.PATH ?? ""}`;
}

async function readProcessStream(
  stream: ReadableStream<Uint8Array> | null | undefined,
  onChunk?: (chunk: string) => void,
): Promise<string> {
  if (!stream) {
    return "";
  }

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let output = "";

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        const trailing = decoder.decode();
        if (trailing) {
          output += trailing;
          onChunk?.(trailing);
        }
        break;
      }

      const chunk = decoder.decode(value, { stream: true });
      output += chunk;
      onChunk?.(chunk);
    }
  } finally {
    reader.releaseLock();
  }

  return output;
}

export async function exec(
  command: string,
  args: string[] = [],
  options: ExecOptions = {},
): Promise<ExecResult> {
  const env = {
    ...process.env,
    PATH: getEnhancedPath(),
    ...options.nodeOptions?.env,
  };

  const proc =
    typeof Bun !== "undefined" && typeof Bun.spawn === "function"
      ? Bun.spawn([command, ...args], {
          stdout: "pipe",
          stderr: "pipe",
          env,
          cwd: options.nodeOptions?.cwd,
        })
      : undefined;

  const result = proc
    ? await readBunProcess(proc, options)
    : await readNodeProcess(command, args, options, env);

  if (options.throwOnError && result.exitCode !== 0) {
    throw new NonZeroExitError(command, result.exitCode, {
      stdout: result.stdout,
      stderr: result.stderr,
    });
  }

  return result;
}

async function readBunProcess(
  proc: Bun.Subprocess<"ignore", "pipe", "pipe">,
  options: ExecOptions,
): Promise<ExecResult> {
  const [stdout, stderr] = await Promise.all([
    readProcessStream(proc.stdout, options.onStdout),
    readProcessStream(proc.stderr, options.onStderr),
  ]);

  const exitCode = await proc.exited;

  return { stdout, stderr, exitCode };
}

async function readNodeProcess(
  command: string,
  args: string[],
  options: ExecOptions,
  env: Record<string, string | undefined>,
): Promise<ExecResult> {
  const proc = nodeSpawn(command, args, {
    stdio: ["ignore", "pipe", "pipe"],
    cwd: options.nodeOptions?.cwd,
    env,
  });

  const [stdout, stderr] = await Promise.all([
    readNodeStream(proc.stdout, options.onStdout),
    readNodeStream(proc.stderr, options.onStderr),
  ]);
  const exitCode = await new Promise<number>((resolve, reject) => {
    proc.on("error", reject);
    proc.on("close", (code: number | null) => resolve(code ?? 0));
  });

  return { stdout, stderr, exitCode };
}

async function readNodeStream(
  stream: NodeJS.ReadableStream | null | undefined,
  onChunk?: (chunk: string) => void,
): Promise<string> {
  if (!stream) return "";

  return await new Promise((resolve, reject) => {
    let output = "";
    stream.on("data", (chunk) => {
      const text = Buffer.isBuffer(chunk)
        ? chunk.toString("utf8")
        : String(chunk);
      output += text;
      onChunk?.(text);
    });
    stream.on("error", reject);
    stream.on("end", () => resolve(output));
  });
}
