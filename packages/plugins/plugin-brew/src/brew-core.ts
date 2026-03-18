import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { PubmPlugin } from "@pubm/core";
import {
  generateFormula,
  releaseAssetsToFormulaAssets,
  updateFormula,
} from "./formula.js";
import { ensureGitIdentity } from "./git-identity.js";
import type { BrewCoreOptions } from "./types.js";

export function brewCore(options: BrewCoreOptions): PubmPlugin {
  return {
    name: "@pubm/plugin-brew-core",
    commands: [
      {
        name: "brew",
        description: "Manage Homebrew formula",
        subcommands: [
          {
            name: "init-core",
            description: "Generate homebrew-core formula",
            action: async () => {
              const cwd = process.cwd();
              const pkgPath = resolve(cwd, "package.json");
              const pkg = existsSync(pkgPath)
                ? JSON.parse(readFileSync(pkgPath, "utf-8"))
                : {};

              const name =
                (pkg.name as string)?.replace(/^@[^/]+\//, "") ?? "my-tool";
              const desc = (pkg.description as string) ?? "A CLI tool";
              const homepage =
                (pkg.homepage as string) ?? `https://github.com/${name}`;
              const license = (pkg.license as string) ?? "MIT";

              const content = generateFormula({
                name,
                desc,
                homepage,
                license,
                version: (pkg.version as string) ?? "0.0.0",
                assets: [],
              });

              const formulaPath = resolve(cwd, options.formula);
              mkdirSync(dirname(formulaPath), { recursive: true });
              writeFileSync(formulaPath, content);
              console.log(
                `homebrew-core formula generated at ${options.formula}`,
              );
            },
          },
        ],
      },
    ],
    hooks: {
      afterRelease: async (_ctx, releaseCtx) => {
        if (
          options.packageName &&
          releaseCtx.displayLabel !== options.packageName
        ) {
          return;
        }
        const { execSync } = await import("node:child_process");

        const cwd = process.cwd();
        const pkgPath = resolve(cwd, "package.json");
        const pkg = existsSync(pkgPath)
          ? JSON.parse(readFileSync(pkgPath, "utf-8"))
          : {};

        const name =
          (pkg.name as string)?.replace(/^@[^/]+\//, "") ?? "my-tool";
        const formulaAssets = releaseAssetsToFormulaAssets(
          releaseCtx.assets,
          options.assetPlatforms,
        );

        // Fork homebrew-core if needed
        try {
          execSync("gh repo fork homebrew/homebrew-core --clone=false", {
            stdio: "pipe",
          });
        } catch {
          // Fork may already exist
        }

        // Get the user's GitHub username for the fork
        const username = execSync("gh api user --jq .login", {
          encoding: "utf-8",
        }).trim();

        // Clone the fork
        const tmpDir = join(tmpdir(), `pubm-brew-core-${Date.now()}`);
        execSync(
          `git clone --depth 1 https://github.com/${username}/homebrew-core.git ${tmpDir}`,
          { stdio: "inherit" },
        );
        ensureGitIdentity(tmpDir);

        // Update or create the formula
        const formulaPath = join(tmpDir, "Formula", `${name}.rb`);
        let content: string;

        if (existsSync(formulaPath)) {
          const existing = readFileSync(formulaPath, "utf-8");
          content = updateFormula(existing, releaseCtx.version, formulaAssets);
        } else {
          content = generateFormula({
            name,
            desc: (pkg.description as string) ?? "A CLI tool",
            homepage: (pkg.homepage as string) ?? "",
            license: (pkg.license as string) ?? "MIT",
            version: releaseCtx.version,
            assets: formulaAssets,
          });
        }

        mkdirSync(dirname(formulaPath), { recursive: true });
        writeFileSync(formulaPath, content);

        // Create branch, commit, push, and open PR
        const branchName = `${name}-${releaseCtx.version}`;
        execSync(
          [
            `cd ${tmpDir}`,
            `git checkout -b ${branchName}`,
            `git add Formula/${name}.rb`,
            `git commit -m "${name} ${releaseCtx.version}"`,
            `git push origin ${branchName}`,
          ].join(" && "),
          { stdio: "inherit" },
        );

        execSync(
          [
            `cd ${tmpDir}`,
            `gh pr create --repo homebrew/homebrew-core --title "${name} ${releaseCtx.version}" --body "Update ${name} formula to version ${releaseCtx.version}"`,
          ].join(" && "),
          { stdio: "inherit" },
        );

        console.log(
          `PR created to homebrew/homebrew-core for ${name} ${releaseCtx.version}`,
        );
      },
    },
  };
}
