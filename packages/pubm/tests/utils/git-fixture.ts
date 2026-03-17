import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

type GitCommand = () => Promise<void>;

export class GitFixture {
  private queue: GitCommand[] = [];

  constructor(private cwd: string) {}

  init(branch = "main"): this {
    this.queue.push(async () => {
      await this.exec("git", ["init", "-b", branch]);
      await this.exec("git", ["config", "user.name", "test"]);
      await this.exec("git", ["config", "user.email", "test@test.com"]);
    });
    return this;
  }

  config(key: string, value: string): this {
    this.queue.push(() => this.exec("git", ["config", key, value]));
    return this;
  }

  add(pathspec = "."): this {
    this.queue.push(() => this.exec("git", ["add", pathspec]));
    return this;
  }

  commit(message: string): this {
    this.queue.push(() => this.exec("git", ["commit", "-m", message]));
    return this;
  }

  tag(name: string): this {
    this.queue.push(() => this.exec("git", ["tag", name]));
    return this;
  }

  branch(name: string): this {
    this.queue.push(() => this.exec("git", ["checkout", "-b", name]));
    return this;
  }

  checkout(ref: string): this {
    this.queue.push(() => this.exec("git", ["checkout", ref]));
    return this;
  }

  async done(): Promise<void> {
    const commands = [...this.queue];
    this.queue = [];

    for (const cmd of commands) {
      await cmd();
    }
  }

  private async exec(command: string, args: string[]): Promise<void> {
    try {
      await execFileAsync(command, args, { cwd: this.cwd });
    } catch (error: any) {
      const stderr = error.stderr || error.message;
      throw new Error(
        `Git command failed: ${command} ${args.join(" ")}\n${stderr}`,
      );
    }
  }
}
