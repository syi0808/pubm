import { stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

export async function findOutFile(
  file: string,
  { cwd = process.cwd() } = {},
): Promise<string | null> {
  let directory = cwd;
  let filePath = "";
  const { root } = path.parse(cwd);

  while (directory) {
    filePath = path.join(directory, file);

    try {
      if ((await stat(filePath)).isFile()) {
        break;
      }
    } catch {}

    directory = path.dirname(directory);

    if (directory === root) return null;
  }

  return filePath;
}
