import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RegistryType } from "../types/options.js";
import { getPackageManager } from "../utils/package-manager.js";
import { Ecosystem } from "./ecosystem.js";

const versionRegex = /("version"\s*:\s*")[^"]*(")/;

export class JsEcosystem extends Ecosystem {
  static async detect(packagePath: string): Promise<boolean> {
    try {
      return (await stat(path.join(packagePath, "package.json"))).isFile();
    } catch {
      return false;
    }
  }

  private async readPackageJson(): Promise<Record<string, unknown>> {
    const raw = await readFile(
      path.join(this.packagePath, "package.json"),
      "utf-8",
    );
    return JSON.parse(raw);
  }

  async packageName(): Promise<string> {
    const pkg = await this.readPackageJson();
    return pkg.name as string;
  }

  async readVersion(): Promise<string> {
    const pkg = await this.readPackageJson();
    return pkg.version as string;
  }

  async writeVersion(newVersion: string): Promise<void> {
    const files = ["package.json", "jsr.json"];

    for (const file of files) {
      const filePath = path.join(this.packagePath, file);
      try {
        const content = await readFile(filePath, "utf-8");
        await writeFile(
          filePath,
          content.replace(versionRegex, `$1${newVersion}$2`),
        );
      } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
  }

  manifestFiles(): string[] {
    return ["package.json"];
  }

  async defaultTestCommand(): Promise<string> {
    const pm = await getPackageManager();
    return `${pm} run test`;
  }

  async defaultBuildCommand(): Promise<string> {
    const pm = await getPackageManager();
    return `${pm} run build`;
  }

  supportedRegistries(): RegistryType[] {
    return ["npm", "jsr"];
  }
}
