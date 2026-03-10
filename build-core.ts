import { existsSync, rmSync } from "node:fs";
import path from "node:path";

const coreDir = path.join(import.meta.dir, "packages/core");
const distDir = path.join(coreDir, "dist");

// Clean dist and tsbuildinfo
if (existsSync(distDir)) {
  rmSync(distDir, { recursive: true });
}
for (const info of ["tsconfig.tsbuildinfo", "tsconfig.build.tsbuildinfo"]) {
  const p = path.join(coreDir, info);
  if (existsSync(p)) rmSync(p);
}

const entrypoint = path.join(coreDir, "src/index.ts");
const nodeBuiltins = (await import("node:module")).builtinModules.flatMap(
  (m) => [m, `node:${m}`],
);

// ESM build
await Bun.build({
  entrypoints: [entrypoint],
  outdir: distDir,
  format: "esm",
  target: "node",
  splitting: false,
  external: nodeBuiltins,
  naming: "index.js",
});

// CJS build
await Bun.build({
  entrypoints: [entrypoint],
  outdir: distDir,
  format: "cjs",
  target: "node",
  splitting: false,
  external: nodeBuiltins,
  naming: "index.cjs",
});

// Types
const tscResult = Bun.spawnSync(
  ["bunx", "tsc", "--project", path.join(coreDir, "tsconfig.build.json")],
  {
    cwd: coreDir,
    stdio: ["inherit", "inherit", "inherit"],
  },
);

if (tscResult.exitCode !== 0) {
  process.exit(1);
}

console.log("@pubm/core build complete");
