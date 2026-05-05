import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const workspaceRoot = dirname(repoRoot);

const shared = {
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  alias: {
    "@pubm/core": resolve(workspaceRoot, "packages/core/src/index.ts"),
    "@pubm/runner": resolve(workspaceRoot, "packages/runner/src/index.ts"),
    "@napi-rs/keyring": resolve(repoRoot, "src/stubs/keyring.ts"),
  },
  banner: {
    js: [
      "import { createRequire as __pubmCreateRequire } from 'node:module';",
      "const require = __pubmCreateRequire(import.meta.url);",
    ].join(""),
  },
};

const actions = [
  ["src/changeset-check/main.ts", "changeset-check/dist/index.js"],
  ["src/release-pr/main.ts", "release-pr/dist/index.js"],
  ["src/publish/main.ts", "publish/dist/index.js"],
];

await Promise.all(
  actions.map(([entryPoint, outfile]) =>
    build({
      ...shared,
      entryPoints: [entryPoint],
      outfile,
    }),
  ),
);
