import process from "node:process";
import { exec } from "../utils/exec.js";
import { NpmPackageRegistry } from "./npm.js";

export class CustomPackageRegistry extends NpmPackageRegistry {
  override async npm(args: string[]): Promise<string> {
    const { stdout } = await exec(
      "npm",
      args.concat("--registry", this.registry!),
      { throwOnError: true },
    );
    return stdout;
  }
}

export async function customPackageRegistry(
  packagePath?: string,
  registryUrl?: string,
): Promise<CustomPackageRegistry> {
  if (packagePath) {
    const manifest = await NpmPackageRegistry.reader.read(packagePath);
    return new CustomPackageRegistry(manifest.name, registryUrl);
  }
  const manifest = await NpmPackageRegistry.reader.read(process.cwd());
  return new CustomPackageRegistry(manifest.name, registryUrl);
}

/** @deprecated Use CustomPackageRegistry */
export const CustomRegistry = CustomPackageRegistry;
/** @deprecated Use customPackageRegistry */
export const customRegistry = customPackageRegistry;
