import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { platform } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
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
  __PUBM_DEV__: "false",
};

mkdirSync(BIN_DIR, { recursive: true });

// Remove cached binary so cli.cjs picks up the fresh build
const CACHED_BIN = join(ROOT, "..", "..", "bin", ".pubm");
if (existsSync(CACHED_BIN)) {
  unlinkSync(CACHED_BIN);
}

console.log("[@pubm/darwin-x64] Compiling...");

await $`bun install @napi-rs/keyring-darwin-x64@1.2.0 --os='darwin' --cpu='x64'`;

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
    target: "bun-darwin-x64",
    outfile: OUT_FILE,
  },
  plugins: [
    createKeyringPlugin(
      ROOT,
      "./node_modules/@napi-rs/keyring-darwin-x64/keyring.darwin-x64.node",
    ),
  ],
  define,
});

if (!result.success) {
  for (const log of result.logs) {
    console.error(log);
  }
  console.error("[@pubm/darwin-x64] Build failed");
  process.exit(1);
}

// Ad-hoc sign the binary so macOS doesn't SIGKILL it
if (platform() === "darwin") {
  await $`codesign -f -s - ${OUT_FILE}`;
} else {
  await $`rcodesign strip ${OUT_FILE}`;
  await $`rcodesign sign ${OUT_FILE}`;
}

console.log(`[@pubm/darwin-x64] Done → ${OUT_FILE}`);
