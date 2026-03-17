import { basename, extname, join } from "node:path";
import { exec } from "../utils/exec.js";
import type { CompressFormat, CompressOption } from "./types.js";

const KNOWN_ARCHIVE_EXTENSIONS = new Set([
  ".tar.gz",
  ".tgz",
  ".tar.xz",
  ".tar.zst",
  ".tar.bz2",
  ".zip",
  ".7z",
  ".dmg",
  ".msi",
  ".exe",
  ".deb",
  ".rpm",
  ".appimage",
  ".pkg",
  ".snap",
  ".flatpak",
  ".wasm",
]);

export function isKnownArchive(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  for (const ext of KNOWN_ARCHIVE_EXTENSIONS) {
    if (lower.endsWith(ext)) return true;
  }
  return false;
}

export function resolveCompressFormat(
  filePath: string,
  os: string | undefined,
  option: CompressOption | undefined,
): CompressFormat | false {
  if (option === false) return false;
  if (typeof option === "string") return option;

  if (option && typeof option === "object" && os && os in option) {
    return option[os];
  }

  if (isKnownArchive(filePath)) return false;

  if (os === "windows") return "zip";
  return "tar.gz";
}

export async function compressFile(
  filePath: string,
  outDir: string,
  format: CompressFormat,
  extraFiles?: string[],
): Promise<string> {
  const file = basename(filePath);
  const dir = join(filePath, "..");
  const archiveName = `${basename(filePath, extname(filePath))}.${format}`;
  const archivePath = join(outDir, archiveName);

  const allFiles = [file, ...(extraFiles?.map((f) => basename(f)) ?? [])];

  switch (format) {
    case "tar.gz":
      await exec("tar", ["-czf", archivePath, "-C", dir, ...allFiles], {
        throwOnError: true,
      });
      break;
    case "tar.xz":
      await exec("tar", ["-cJf", archivePath, "-C", dir, ...allFiles], {
        throwOnError: true,
      });
      break;
    case "tar.zst":
      await exec(
        "tar",
        ["--zstd", "-cf", archivePath, "-C", dir, ...allFiles],
        { throwOnError: true },
      );
      break;
    case "zip":
      await exec("zip", ["-j", archivePath, filePath, ...(extraFiles ?? [])], {
        throwOnError: true,
      });
      break;
  }

  return archivePath;
}
