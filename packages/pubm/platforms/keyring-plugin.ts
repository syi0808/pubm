import { resolve } from "node:path";

export function createKeyringPlugin(
  root: string,
  addonPath: string,
): Bun.BunPlugin {
  const resolvedPath = resolve(root, addonPath);

  return {
    name: "keyring-loader",
    setup(build) {
      build.onResolve({ filter: /^@napi-rs\/keyring$/ }, () => {
        return { path: "virtual:keyring-loader", namespace: "keyring" };
      });

      build.onLoad(
        { filter: /^virtual:keyring-loader$/, namespace: "keyring" },
        () => {
          return {
            loader: "js",
            contents: `module.exports = require(${JSON.stringify(resolvedPath)});`,
          };
        },
      );
    },
  };
}
