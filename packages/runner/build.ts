import { existsSync, rmSync } from "node:fs";
import path from "node:path";

const packageDir = import.meta.dir;
const distDir = path.join(packageDir, "dist");

if (existsSync(distDir)) {
  rmSync(distDir, { recursive: true, force: true });
}

for (const info of ["tsconfig.tsbuildinfo", "tsconfig.build.tsbuildinfo"]) {
  const infoPath = path.join(packageDir, info);
  if (existsSync(infoPath)) {
    rmSync(infoPath);
  }
}

const entrypoint = path.join(packageDir, "src/index.ts");
const nodeBuiltins = (await import("node:module")).builtinModules.flatMap(
  (moduleName) => [moduleName, `node:${moduleName}`],
);

for (const format of ["esm", "cjs"] as const) {
  const result = await Bun.build({
    entrypoints: [entrypoint],
    outdir: distDir,
    format,
    target: "node",
    splitting: false,
    external: nodeBuiltins,
    naming: format === "esm" ? "index.js" : "index.cjs",
  });

  if (!result.success) {
    for (const log of result.logs) {
      console.error(log);
    }
    process.exit(1);
  }
}

const tscResult = Bun.spawnSync(
  ["bunx", "tsc", "--project", path.join(packageDir, "tsconfig.build.json")],
  {
    cwd: packageDir,
    stdio: ["inherit", "inherit", "inherit"],
  },
);

if (tscResult.exitCode !== 0) {
  process.exit(1);
}

console.log("@pubm/runner build complete");
