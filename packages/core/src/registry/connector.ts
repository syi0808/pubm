import { exec } from "../utils/exec.js";

export abstract class RegistryConnector {
  constructor(public registryUrl: string) {}
  abstract ping(): Promise<boolean>;
  abstract version(): Promise<string>;

  protected abstract getVersionCommand(): [string, string[]];

  async isInstalled(): Promise<boolean> {
    try {
      const [cmd, args] = this.getVersionCommand();
      await exec(cmd, args, { throwOnError: true });
      return true;
    } catch {
      return false;
    }
  }
}
