import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const ROOT = import.meta.dir;
const NPM_DIR = join(ROOT, "npm");
const ENTRY = join(ROOT, "src", "cli.ts");

const pkg = await Bun.file(join(ROOT, "package.json")).json();
const VERSION = pkg.version as string;

// ── Platform Binaries ───────────────────────────────────────────────────

interface Target {
  os: string;
  arch: "arm64" | "x64";
}

const allTargets: Target[] = [
  { os: "darwin", arch: "arm64" },
  { os: "darwin", arch: "x64" },
  { os: "linux", arch: "arm64" },
  { os: "linux", arch: "x64" },
  { os: "win32", arch: "x64" },
];

function platformName(t: Target): string {
  const os = t.os === "win32" ? "windows" : t.os;
  return `@pubm/${os}-${t.arch}`;
}

function bunTarget(t: Target): string {
  return `bun-${t.os === "win32" ? "windows" : t.os}-${t.arch}`;
}

const args = process.argv.slice(2);
const currentOnly = args.includes("--current");

let targets = allTargets;
if (currentOnly) {
  targets = allTargets.filter(
    (t) => t.os === process.platform && t.arch === process.arch,
  );
  if (targets.length === 0) {
    console.error(
      `No matching target for current platform: ${process.platform}-${process.arch}`,
    );
    process.exit(1);
  }
}

// Clean previous platform builds
if (existsSync(NPM_DIR)) {
  rmSync(NPM_DIR, { recursive: true });
}

console.log(
  `\nBuilding pubm v${VERSION} binaries for ${targets.length} target(s)...\n`,
);

let succeeded = 0;
let failed = 0;

for (const target of targets) {
  const name = platformName(target);
  const pkgDir = join(NPM_DIR, name);
  const binDir = join(pkgDir, "bin");
  const isWindows = target.os === "win32";
  const binaryName = isWindows ? "pubm.exe" : "pubm";
  const outFile = join(binDir, binaryName);

  mkdirSync(binDir, { recursive: true });

  console.log(`[${name}] Compiling...`);

  const result = Bun.spawnSync(
    [
      "bun",
      "build",
      "--compile",
      `--target=${bunTarget(target)}`,
      ENTRY,
      "--outfile",
      outFile,
    ],
    {
      cwd: ROOT,
      stdout: "inherit",
      stderr: "inherit",
    },
  );

  if (result.exitCode !== 0) {
    console.error(`[${name}] Build failed with exit code ${result.exitCode}`);
    if (currentOnly) process.exit(1);
    failed++;
    continue;
  }

  // Write platform package.json
  const platformPkg = {
    name,
    version: VERSION,
    description: `pubm binary for ${name.replace("@pubm/", "")}`,
    license: "Apache-2.0",
    author: "Sung YeIn",
    repository: {
      type: "git",
      url: "git+https://github.com/syi0808/pubm.git",
    },
    homepage: "https://github.com/syi0808/pubm#readme",
    os: [target.os],
    cpu: [target.arch],
  };

  await Bun.write(
    join(pkgDir, "package.json"),
    `${JSON.stringify(platformPkg, null, 2)}\n`,
  );

  console.log(`[${name}] Done → ${outFile}\n`);
  succeeded++;
}

console.log(`\nBuild complete: ${succeeded} succeeded, ${failed} failed.`);
if (succeeded > 0) console.log(`Output: ${NPM_DIR}`);
