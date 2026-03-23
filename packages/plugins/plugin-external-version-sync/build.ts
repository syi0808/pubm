import { existsSync, rmSync } from "node:fs";
import path from "node:path";

const pluginDir = import.meta.dir;
const distDir = path.join(pluginDir, "dist");

if (existsSync(distDir)) {
  rmSync(distDir, { recursive: true, force: true });
}

for (const info of ["tsconfig.tsbuildinfo", "tsconfig.build.tsbuildinfo"]) {
  const infoPath = path.join(pluginDir, info);
  if (existsSync(infoPath)) {
    rmSync(infoPath);
  }
}

const entrypoint = path.join(pluginDir, "src/index.ts");
const nodeBuiltins = (await import("node:module")).builtinModules.flatMap(
  (moduleName) => [moduleName, `node:${moduleName}`],
);

const result = await Bun.build({
  entrypoints: [entrypoint],
  outdir: distDir,
  format: "esm",
  target: "node",
  splitting: false,
  external: [...nodeBuiltins, "@pubm/core"],
  naming: "index.js",
});

if (!result.success) {
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}

const tscResult = Bun.spawnSync(
  ["bunx", "tsc", "--project", path.join(pluginDir, "tsconfig.build.json")],
  {
    cwd: pluginDir,
    stdio: ["inherit", "inherit", "inherit"],
  },
);

if (tscResult.exitCode !== 0) {
  process.exit(1);
}

console.log("@pubm/plugin-external-version-sync build complete");
