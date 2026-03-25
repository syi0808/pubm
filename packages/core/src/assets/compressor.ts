import { unlinkSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { exec } from "../utils/exec.js";
import type { CompressFormat, CompressOption } from "./types.js";

const isWin = process.platform === "win32";

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
  archiveBaseName?: string,
): Promise<string> {
  const file = basename(filePath);
  const dir = join(filePath, "..");
  const stem = archiveBaseName ?? basename(filePath, extname(filePath));
  const archiveName = `${stem}.${format}`;
  const archivePath = join(outDir, archiveName);

  const allFiles = [file, ...(extraFiles?.map((f) => basename(f)) ?? [])];

  switch (format) {
    case "tar.gz":
      await exec("tar", ["-czf", archivePath, "-C", dir, ...allFiles], {
        throwOnError: true,
      });
      break;
    case "tar.xz":
      if (isWin) {
        await tarThenCompress(archivePath, dir, allFiles, "xz");
      } else {
        await exec("tar", ["-cJf", archivePath, "-C", dir, ...allFiles], {
          throwOnError: true,
        });
      }
      break;
    case "tar.zst":
      if (isWin) {
        await tarThenCompress(archivePath, dir, allFiles, "zstd");
      } else {
        await exec(
          "tar",
          ["--zstd", "-cf", archivePath, "-C", dir, ...allFiles],
          { throwOnError: true },
        );
      }
      break;
    case "zip":
      if (isWin) {
        const sources = [filePath, ...(extraFiles ?? [])].join("','");
        await exec(
          "powershell",
          [
            "-NoProfile",
            "-Command",
            `Compress-Archive -Path '${sources}' -DestinationPath '${archivePath}'`,
          ],
          { throwOnError: true },
        );
      } else {
        await exec(
          "zip",
          ["-j", archivePath, filePath, ...(extraFiles ?? [])],
          { throwOnError: true },
        );
      }
      break;
  }

  return archivePath;
}

/**
 * Windows fallback: create a plain .tar, then compress with a separate tool.
 * bsdtar (shipped with Windows) doesn't support -J (xz) or --zstd flags.
 *
 * xz compresses in-place: `xz file.tar` → `file.tar.xz` (removes original)
 * zstd needs explicit output: `zstd file.tar -o file.tar.zst`
 */
/* istanbul ignore next -- Windows-only bsdtar fallback, no Windows CI */
async function tarThenCompress(
  archivePath: string,
  dir: string,
  files: string[],
  compressor: "xz" | "zstd",
): Promise<void> {
  const tarPath = archivePath.replace(/\.(xz|zst)$/, "");
  await exec("tar", ["-cf", tarPath, "-C", dir, ...files], {
    throwOnError: true,
  });
  try {
    const args =
      compressor === "xz"
        ? [tarPath] // xz replaces file.tar with file.tar.xz
        : [tarPath, "-o", archivePath, "--rm"]; // zstd outputs to target, removes source
    await exec(compressor, args, { throwOnError: true });
  } finally {
    try {
      unlinkSync(tarPath);
    } catch {
      // best-effort: xz already removed it, zstd --rm may have removed it
    }
  }
}
