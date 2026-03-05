import { exec } from "tinyexec";
import { getPackageJson } from "../utils/package.js";
import { NpmRegistry } from "./npm.js";

export class CustomRegistry extends NpmRegistry {
  async npm(args: string[]): Promise<string> {
    const { stdout } = await exec(
      "npm",
      args.concat("--registry", this.registry),
      { throwOnError: true },
    );

    return stdout;
  }
}

export async function customRegistry(): Promise<CustomRegistry> {
  const packageJson = await getPackageJson();

  return new CustomRegistry(packageJson.name);
}
