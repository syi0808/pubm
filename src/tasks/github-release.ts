import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import SemVer from "semver";
import { Git } from "../git.js";
import { exec } from "../utils/exec.js";

const { prerelease } = SemVer;

export interface ReleaseAsset {
  name: string;
  url: string;
  sha256: string;
}

export interface ReleaseContext {
  version: string;
  tag: string;
  releaseUrl: string;
  assets: ReleaseAsset[];
}

interface Ctx {
  version: string;
}

/**
 * Discover platform binary directories under npm/@pubm-*\/bin/
 */
function discoverPlatformBinaries(
  rootDir: string,
): { name: string; path: string }[] {
  const scopeDir = join(rootDir, "npm", "@pubm");
  if (!existsSync(scopeDir)) return [];

  const entries = readdirSync(scopeDir, { withFileTypes: true });
  const binaries: { name: string; path: string }[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const binDir = join(scopeDir, entry.name, "bin");
    if (!existsSync(binDir)) continue;

    const files = readdirSync(binDir);
    for (const file of files) {
      binaries.push({
        name: `pubm-${entry.name}`,
        path: join(binDir, file),
      });
    }
  }

  return binaries;
}

/**
 * Compute SHA256 hash of a file
 */
function sha256(filePath: string): string {
  const content = readFileSync(filePath);
  return createHash("sha256").update(content).digest("hex");
}

/**
 * Compress a binary into a .tar.gz archive and return the archive path
 */
async function compressBinary(
  binaryPath: string,
  archiveName: string,
  outDir: string,
): Promise<string> {
  const archivePath = join(outDir, `${archiveName}.tar.gz`);
  const binaryFile = basename(binaryPath);
  const binaryDir = join(binaryPath, "..");

  await exec("tar", ["-czf", archivePath, "-C", binaryDir, binaryFile], {
    throwOnError: true,
  });

  return archivePath;
}

/**
 * Parse the release URL from gh release create output
 */
function parseReleaseUrl(output: string): string {
  const match = output.trim().match(/https:\/\/github\.com\/\S+/);
  return match?.[0] ?? "";
}

/**
 * Create a GitHub Release using the `gh` CLI with binary assets
 */
export async function createGitHubRelease(ctx: Ctx): Promise<ReleaseContext> {
  const git = new Git();

  // Get tags
  const latestTag = `${await git.latestTag()}`;
  const previousTag =
    (await git.previousTag(latestTag)) || (await git.firstCommit());

  // Discover and compress platform binaries
  const rootDir = process.cwd();
  const binaries = discoverPlatformBinaries(rootDir);
  const tempDir = join(tmpdir(), `pubm-release-${Date.now()}`);

  const assetPaths: { name: string; path: string; sha256: string }[] = [];

  if (binaries.length > 0) {
    const { mkdirSync } = await import("node:fs");
    mkdirSync(tempDir, { recursive: true });

    for (const binary of binaries) {
      const archivePath = await compressBinary(
        binary.path,
        binary.name,
        tempDir,
      );
      assetPaths.push({
        name: `${binary.name}.tar.gz`,
        path: archivePath,
        sha256: sha256(archivePath),
      });
    }
  }

  // Build gh release create command
  const ghArgs = [
    "release",
    "create",
    latestTag,
    "--title",
    `pubm v${ctx.version}`,
    "--generate-notes",
    "--notes-start-tag",
    previousTag,
  ];

  if (prerelease(ctx.version)) {
    ghArgs.push("--prerelease");
  }

  // Add asset files
  for (const asset of assetPaths) {
    ghArgs.push(asset.path);
  }

  const { stdout } = await exec("gh", ghArgs, { throwOnError: true });
  const releaseUrl = parseReleaseUrl(stdout);

  // Build the release context
  const assets: ReleaseAsset[] = assetPaths.map((asset) => ({
    name: asset.name,
    url: releaseUrl
      ? `${releaseUrl.replace("/releases/tag/", "/releases/download/")}/${asset.name}`
      : "",
    sha256: asset.sha256,
  }));

  return {
    version: ctx.version,
    tag: latestTag,
    releaseUrl,
    assets,
  };
}
