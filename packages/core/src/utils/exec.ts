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
  const proc = Bun.spawn([command, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      PATH: getEnhancedPath(),
      ...options.nodeOptions?.env,
    },
    cwd: options.nodeOptions?.cwd,
  });

  const [stdout, stderr] = await Promise.all([
    readProcessStream(proc.stdout, options.onStdout),
    readProcessStream(proc.stderr, options.onStderr),
  ]);

  const exitCode = await proc.exited;

  if (options.throwOnError && exitCode !== 0) {
    throw new NonZeroExitError(command, exitCode, { stdout, stderr });
  }

  return { stdout, stderr, exitCode };
}
