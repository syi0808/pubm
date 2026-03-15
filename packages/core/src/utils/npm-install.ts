import { exec } from "./exec.js";

export async function npmInstallGlobally(packageName: string): Promise<void> {
  await exec("npm", ["install", "-g", packageName], { throwOnError: true });
}
