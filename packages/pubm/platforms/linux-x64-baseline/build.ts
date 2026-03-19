import { mkdirSync } from "node:fs";
import { join } from "node:path";
import pubmPackageJson from "../../package.json" with { type: "json" };
import { createKeyringPlugin } from "../keyring-plugin.ts";

const ROOT = import.meta.dir;
const CLI_ENTRY = join(ROOT, "..", "..", "src", "cli.ts");
const TSCONFIG = join(ROOT, "..", "..", "tsconfig.build.json");
const BIN_DIR = join(ROOT, "bin");
const OUT_FILE = join(BIN_DIR, "pubm");
const define = {
  __PUBM_VERSION__: JSON.stringify(pubmPackageJson.version),
  __PUBM_NODE_ENGINE__: JSON.stringify(pubmPackageJson.engines?.node ?? ">=18"),
  __PUBM_GIT_ENGINE__: JSON.stringify(
    pubmPackageJson.engines?.git ?? ">=2.11.0",
  ),
  // @ts-expect-error
  __PUBM_NPM_ENGINE__: JSON.stringify(pubmPackageJson.engines?.npm ?? "*"),
  // @ts-expect-error
  __PUBM_PNPM_ENGINE__: JSON.stringify(pubmPackageJson.engines?.pnpm ?? "*"),
  // @ts-expect-error
  __PUBM_YARN_ENGINE__: JSON.stringify(pubmPackageJson.engines?.yarn ?? "*"),
};

mkdirSync(BIN_DIR, { recursive: true });

console.log("[@pubm/linux-x64-baseline] Compiling...");

const result = await Bun.build({
  tsconfig: TSCONFIG,
  entrypoints: [CLI_ENTRY],
  minify: true,
  sourcemap: "external",
  compile: {
    autoloadBunfig: false,
    autoloadDotenv: false,
    autoloadTsconfig: false,
    autoloadPackageJson: true,
    target: "bun-linux-x64-baseline",
    outfile: OUT_FILE,
  },
  plugins: [createKeyringPlugin(ROOT, "./node_modules/@napi-rs/keyring-linux-x64-gnu/keyring.linux-x64-gnu.node")],
  define,
});

if (!result.success) {
  for (const log of result.logs) {
    console.error(log);
  }
  console.error("[@pubm/linux-x64-baseline] Build failed");
  process.exit(1);
}

console.log(`[@pubm/linux-x64-baseline] Done → ${OUT_FILE}`);
