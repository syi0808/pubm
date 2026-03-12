import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";

const coreDir = path.join(import.meta.dir, "packages/core");
const distDir = path.join(coreDir, "dist");
const cliPackageJsonPath = path.join(import.meta.dir, "packages/cli/package.json");
const cliPackageJson = JSON.parse(readFileSync(cliPackageJsonPath, "utf-8")) as {
  version: string;
  engines?: Partial<Record<string, string>>;
};
const define = {
  __PUBM_VERSION__: JSON.stringify(cliPackageJson.version),
  __PUBM_NODE_ENGINE__: JSON.stringify(cliPackageJson.engines?.node ?? ">=18"),
  __PUBM_GIT_ENGINE__: JSON.stringify(
    cliPackageJson.engines?.git ?? ">=2.11.0",
  ),
  __PUBM_NPM_ENGINE__: JSON.stringify(cliPackageJson.engines?.npm ?? "*"),
  __PUBM_PNPM_ENGINE__: JSON.stringify(cliPackageJson.engines?.pnpm ?? "*"),
  __PUBM_YARN_ENGINE__: JSON.stringify(cliPackageJson.engines?.yarn ?? "*"),
};

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
  define,
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
  define,
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
