import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { PubmPlugin } from "@pubm/core";
import {
  generateFormula,
  releaseAssetsToFormulaAssets,
  updateFormula,
} from "./formula.js";
import { ensureGitIdentity } from "./git-identity.js";
import type { BrewTapOptions } from "./types.js";

export function brewTap(options: BrewTapOptions): PubmPlugin {
  return {
    name: "@pubm/plugin-brew-tap",
    commands: [
      {
        name: "brew",
        description: "Manage Homebrew formula",
        subcommands: [
          {
            name: "init",
            description: "Generate Homebrew formula template",
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
              console.log(`Formula generated at ${options.formula}`);
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
        const formulaAssets = releaseAssetsToFormulaAssets(
          releaseCtx.assets,
          options.assetPlatforms,
        );
        const formulaPath = resolve(process.cwd(), options.formula);

        let content: string;

        if (existsSync(formulaPath)) {
          const existing = readFileSync(formulaPath, "utf-8");
          content = updateFormula(existing, releaseCtx.version, formulaAssets);
        } else {
          const cwd = process.cwd();
          const pkgPath = resolve(cwd, "package.json");
          const pkg = existsSync(pkgPath)
            ? JSON.parse(readFileSync(pkgPath, "utf-8"))
            : {};

          const name =
            (pkg.name as string)?.replace(/^@[^/]+\//, "") ?? "my-tool";

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
        console.log(`Formula updated at ${options.formula}`);

        if (!options.repo) {
          const { execSync } = await import("node:child_process");
          ensureGitIdentity();

          execSync(`git add ${formulaPath}`, { stdio: "inherit" });
          execSync(
            `git commit -m "chore(brew): update formula to ${releaseCtx.version}"`,
            { stdio: "inherit" },
          );

          try {
            execSync("git push", { stdio: "inherit" });
          } catch {
            const branch = `pubm/brew-formula-v${releaseCtx.version}`;
            execSync(`git checkout -b ${branch}`, { stdio: "inherit" });
            execSync(`git push origin ${branch}`, { stdio: "inherit" });
            execSync(
              `gh pr create --title "chore(brew): update formula to ${releaseCtx.version}" --body "Automated formula update by pubm"`,
              { stdio: "inherit" },
            );
            console.log(`Created PR on branch ${branch}`);
          }
          return;
        }

        if (options.repo) {
          // Separate tap repo: clone, update formula, commit and push
          const { tmpdir } = await import("node:os");
          const { basename, join } = await import("node:path");
          const { execSync } = await import("node:child_process");

          const tmpDir = join(tmpdir(), `pubm-brew-tap-${Date.now()}`);
          const formulaFile = basename(formulaPath);

          const ghToken = process.env.GITHUB_TOKEN;
          const repoUrl = /^[^/]+\/[^/]+$/.test(options.repo)
            ? ghToken
              ? `https://x-access-token:${ghToken}@github.com/${options.repo}.git`
              : `https://github.com/${options.repo}.git`
            : options.repo;
          execSync(`git clone --depth 1 ${repoUrl} ${tmpDir}`, {
            stdio: "inherit",
          });
          ensureGitIdentity(tmpDir);

          const targetDir = join(tmpDir, "Formula");
          mkdirSync(targetDir, { recursive: true });
          writeFileSync(join(targetDir, formulaFile), content);

          execSync(
            [
              `cd ${tmpDir}`,
              `git add Formula/${formulaFile}`,
              `git commit -m "Update ${formulaFile} to ${releaseCtx.version}"`,
            ].join(" && "),
            { stdio: "inherit" },
          );

          try {
            execSync(`git -C ${tmpDir} push`, { stdio: "inherit" });
          } catch {
            const branch = `pubm/brew-formula-v${releaseCtx.version}`;
            execSync(`git -C ${tmpDir} checkout -b ${branch}`, {
              stdio: "inherit",
            });
            execSync(`git -C ${tmpDir} push origin ${branch}`, {
              stdio: "inherit",
            });
            const repoSlug = /^[^/]+\/[^/]+$/.test(options.repo)
              ? options.repo
              : "";
            execSync(
              `gh pr create --repo ${repoSlug} --title "Update ${formulaFile} to ${releaseCtx.version}" --body "Automated formula update by pubm"`,
              { stdio: "inherit", cwd: tmpDir },
            );
            console.log(`Created PR on branch ${branch}`);
          }
        }
      },
    },
  };
}
