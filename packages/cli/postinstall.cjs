#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

function main() {
  const platformMap = { darwin: "darwin", linux: "linux", win32: "windows" };
  const archMap = { x64: "x64", arm64: "arm64" };

  const platform = platformMap[os.platform()] || os.platform();
  const arch = archMap[os.arch()] || os.arch();
  const packageName = `@pubm/${platform}-${arch}`;
  const binaryName = platform === "windows" ? "pubm.exe" : "pubm";

  try {
    const packageJsonPath = require.resolve(`${packageName}/package.json`);
    const binaryPath = path.join(
      path.dirname(packageJsonPath),
      "bin",
      binaryName,
    );

    if (!fs.existsSync(binaryPath)) {
      console.warn(
        `pubm: binary not found at ${binaryPath}. Run \`bun run build\` to compile platform binaries.`,
      );
      process.exit(0);
    }

    console.log(`pubm: platform binary verified (${packageName})`);
  } catch {
    console.error(
      `pubm: could not find platform binary package. You may need to install it manually for your platform (${os.platform()}-${os.arch()}).`,
    );
    process.exit(0);
  }
}

main();
