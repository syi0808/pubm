import { existsSync } from "node:fs";
import path from "node:path";
import { runPubmCli } from "./cli.js";

const PLATFORM_MAP: Record<string, string> = {
  darwin: "darwin",
  linux: "linux",
  win32: "windows",
};

const ARCH_MAP: Record<string, string> = {
  arm64: "arm64",
  x64: "x64",
};

export type RunResult = Awaited<ReturnType<typeof runPubmCli>>;

export class BinaryRunner {
  constructor(private cwd: string) {}

  static resolveBinaryPath(): string {
    const platform = PLATFORM_MAP[process.platform];
    const arch = ARCH_MAP[process.arch];

    if (!platform || !arch) {
      throw new Error(
        `Unsupported platform: ${process.platform}-${process.arch}`,
      );
    }

    const binaryName = process.platform === "win32" ? "pubm.exe" : "pubm";
    const binaryPath = path.resolve(
      import.meta.dirname,
      "../../platforms",
      `${platform}-${arch}`,
      "bin",
      binaryName,
    );

    if (!existsSync(binaryPath)) {
      throw new Error(
        `Binary not found at ${binaryPath}. Run 'bun run build' first.`,
      );
    }

    return binaryPath;
  }

  async run(...args: string[]): Promise<RunResult> {
    const binaryPath = BinaryRunner.resolveBinaryPath();
    return runPubmCli(binaryPath, { nodeOptions: { cwd: this.cwd } }, ...args);
  }

  async runWithEnv(
    env: Record<string, string>,
    ...args: string[]
  ): Promise<RunResult> {
    const binaryPath = BinaryRunner.resolveBinaryPath();
    return runPubmCli(
      binaryPath,
      { nodeOptions: { cwd: this.cwd, env } },
      ...args,
    );
  }
}
