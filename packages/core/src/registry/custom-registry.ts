import { exec } from "../utils/exec.js";
import { NpmPackageRegistry } from "./npm.js";

export class CustomPackageRegistry extends NpmPackageRegistry {
  override async npm(args: string[], cwd?: string): Promise<string> {
    if (!this.registry) {
      throw new Error("Custom registry URL is required for npm operations.");
    }

    const { stdout } = await exec(
      "npm",
      args.concat("--registry", this.registry),
      {
        throwOnError: true,
        nodeOptions: cwd ? { cwd } : undefined,
      },
    );
    return stdout;
  }
}

export async function customPackageRegistry(
  packagePath: string,
  registryUrl?: string,
): Promise<CustomPackageRegistry> {
  const manifest = await NpmPackageRegistry.reader.read(packagePath);
  return new CustomPackageRegistry(manifest.name, packagePath, registryUrl);
}
