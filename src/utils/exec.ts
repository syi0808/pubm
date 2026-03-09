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

export async function exec(
  command: string,
  args: string[] = [],
  options: ExecOptions = {},
): Promise<ExecResult> {
  const proc = Bun.spawn([command, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: options.nodeOptions?.env
      ? { ...process.env, ...options.nodeOptions.env }
      : undefined,
    cwd: options.nodeOptions?.cwd,
  });

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  const exitCode = await proc.exited;

  if (options.throwOnError && exitCode !== 0) {
    throw new NonZeroExitError(command, exitCode, { stdout, stderr });
  }

  return { stdout, stderr, exitCode };
}
