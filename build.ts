import { rmSync } from "node:fs";
import { builtinModules } from "node:module";

// External packages: Node.js builtins
const external = [...builtinModules, ...builtinModules.map((m) => `node:${m}`)];

// Clean output directories
rmSync("dist", { recursive: true, force: true });
rmSync("bin", { recursive: true, force: true });

// Build library ESM: src/index.ts → dist/index.js
const esmResult = await Bun.build({
  entrypoints: ["src/index.ts"],
  outdir: "dist",
  target: "node",
  format: "esm",
  splitting: false,
  external: external,
  packages: "bundle",
  naming: "index.js",
});

if (!esmResult.success) {
  console.error("ESM build failed:", esmResult.logs);
  process.exit(1);
}

// Build library CJS: src/index.ts → dist/index.cjs
const cjsResult = await Bun.build({
  entrypoints: ["src/index.ts"],
  outdir: "dist",
  target: "node",
  format: "cjs",
  splitting: false,
  external: external,
  packages: "bundle",
  naming: "index.cjs",
});

if (!cjsResult.success) {
  console.error("CJS build failed:", cjsResult.logs);
  process.exit(1);
}

// Build CLI: src/cli.ts → bin/cli.js (ESM with Node shebang)
const cliResult = await Bun.build({
  entrypoints: ["src/cli.ts"],
  outdir: "bin",
  target: "node",
  format: "esm",
  splitting: false,
  external: external,
  packages: "bundle",
  naming: "cli.js",
});

if (!cliResult.success) {
  console.error("CLI build failed:", cliResult.logs);
  process.exit(1);
}

// Prepend shebang to CLI output
const cliPath = "bin/cli.js";
const cliContent = await Bun.file(cliPath).text();
await Bun.write(cliPath, `#!/usr/bin/env node\n${cliContent}`);

console.log("Build complete.");
console.log("  dist/index.js  (ESM)");
console.log("  dist/index.cjs (CJS)");
console.log("  bin/cli.js     (CLI)");

// Generate type declarations
console.log("Generating type declarations...");
const tsc = Bun.spawn(["tsc", "--project", "tsconfig.build.json"], {
  stdout: "inherit",
  stderr: "inherit",
});
const tscExitCode = await tsc.exited;
if (tscExitCode !== 0) {
  console.error("Type declaration generation failed");
  process.exit(1);
}
console.log("  dist/index.d.ts (types)");

// Single binary (only when --compile flag passed)
if (process.argv.includes("--compile")) {
  const targets = [
    "bun-linux-x64",
    "bun-linux-arm64",
    "bun-darwin-x64",
    "bun-darwin-arm64",
    "bun-windows-x64",
  ];

  const { mkdirSync } = await import("node:fs");
  mkdirSync("releases", { recursive: true });

  for (const target of targets) {
    const ext = target.includes("windows") ? ".exe" : "";
    const outfile = `releases/pubm-${target}${ext}`;
    const proc = Bun.spawn(
      [
        "bun",
        "build",
        "--compile",
        `--target=${target}`,
        "src/cli.ts",
        "--outfile",
        outfile,
      ],
      { stdout: "inherit", stderr: "inherit" },
    );
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      console.error(`Failed to compile for target: ${target}`);
      process.exit(1);
    }
    console.log(`Built: ${outfile}`);
  }
}
