import process from "node:process";
import { exec } from "../utils/exec.js";
import { NpmRegistry } from "./npm.js";

export class CustomRegistry extends NpmRegistry {
  async npm(args: string[]): Promise<string> {
    const { stdout } = await exec(
      "npm",
      args.concat("--registry", this.registry!),
      { throwOnError: true },
    );

    return stdout;
  }
}

export async function customRegistry(): Promise<CustomRegistry> {
  const manifest = await NpmRegistry.reader.read(process.cwd());

  return new CustomRegistry(manifest.name);
}
