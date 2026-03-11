import { mkdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = import.meta.dir;
const CLI_ENTRY = join(ROOT, "..", "..", "src", "cli.ts");
const BIN_DIR = join(ROOT, "bin");
const OUT_FILE = join(BIN_DIR, "pubm");

mkdirSync(BIN_DIR, { recursive: true });

console.log("[@pubm/linux-arm64] Compiling...");

const result = Bun.spawnSync(
  [
    "bun",
    "build",
    "--compile",
    "--minify",
    "--compile-autoload-package-json",
    "--target=bun-linux-arm64",
    CLI_ENTRY,
    "--outfile",
    OUT_FILE,
  ],
  { cwd: ROOT, stdout: "inherit", stderr: "inherit" },
);

if (result.exitCode !== 0) {
  console.error("[@pubm/linux-arm64] Build failed");
  process.exit(1);
}

console.log(`[@pubm/linux-arm64] Done → ${OUT_FILE}`);
