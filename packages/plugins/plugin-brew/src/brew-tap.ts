import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { type PubmPlugin, resolvePhases } from "@pubm/core";
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
    credentials: (ctx) => {
      // PAT is only needed in CI where interactive git/gh auth is unavailable
      if (!options.repo || ctx.options.mode !== "ci") return [];
      return [
        {
          key: "brew-github-token",
          env: "PUBM_BREW_GITHUB_TOKEN",
          label: "GitHub PAT for Homebrew tap",
          tokenUrl: "https://github.com/settings/tokens/new?scopes=repo",
          tokenUrlLabel: "github.com",
          ghSecretName: "PUBM_BREW_GITHUB_TOKEN",
          required: true,
        },
      ];
    },
    checks: (ctx) => {
      const phases = resolvePhases(ctx.options);
      if (!phases.includes("publish") && ctx.options.mode !== "ci") return [];

      // CI: verify PAT exists (only relevant when repo is set)
      if (ctx.options.mode === "ci") {
        if (!options.repo) return [];
        return [
          {
            title: "Checking Homebrew tap token availability",
            phase: "conditions" as const,
            task: async (ctx, task) => {
              const token = ctx.runtime.pluginTokens?.["brew-github-token"];
              if (!token) {
                throw new Error(
                  "PUBM_BREW_GITHUB_TOKEN is required for Homebrew tap publishing.",
                );
              }
              task.output = "Homebrew tap token verified";
            },
          },
        ];
      }

      // Local, !repo: no checks needed — git push uses existing auth,
      // gh pr create is only a fallback
      if (!options.repo) return [];

      // Local, repo: verify gh auth + repo access
      const targetRepo = options.repo;
      return [
        {
          title: "Checking git/gh access for Homebrew tap",
          phase: "conditions" as const,
          task: async (_ctx, task) => {
            const { execFileSync } = await import("node:child_process");

            try {
              execFileSync("gh", ["auth", "status"], { stdio: "pipe" });
              task.output = "GitHub CLI authenticated";
            } catch {
              throw new Error(
                "GitHub CLI is not authenticated. Run `gh auth login` first.",
              );
            }

            const repoName = /^[^/]+\/[^/]+$/.test(targetRepo)
              ? targetRepo
              : targetRepo.match(/github\.com[/:]([^/]+\/[^/.]+)/)?.[1];
            if (repoName) {
              try {
                execFileSync(
                  "gh",
                  ["repo", "view", repoName, "--json", "name"],
                  { stdio: "pipe" },
                );
                task.output = `Access to ${repoName} verified`;
              } catch {
                throw new Error(
                  `Cannot access tap repository '${targetRepo}'. Check your GitHub permissions.`,
                );
              }
            }
          },
        },
      ];
    },
    hooks: {
      afterRelease: async (ctx, releaseCtx) => {
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

        {
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
            const prUrl = execSync(
              `gh pr create --title "chore(brew): update formula to ${releaseCtx.version}" --body "Automated formula update by pubm"`,
              { encoding: "utf-8" },
            ).trim();
            const prNumber = prUrl.match(/\/pull\/(\d+)/)?.[1];
            if (prNumber) {
              ctx.runtime.rollback.add({
                label: `Close Homebrew tap PR #${prNumber}`,
                fn: async () => {
                  execSync(
                    `gh pr close ${prNumber} --comment "Closed by pubm rollback"`,
                    { stdio: "inherit" },
                  );
                },
                confirm: true,
              });
            }
            console.log(`Created PR on branch ${branch}`);
          }
        }

        if (options.repo) {
          // Separate tap repo: clone, update formula, commit and push
          const { tmpdir } = await import("node:os");
          const { basename, join } = await import("node:path");
          const { execSync } = await import("node:child_process");

          const tmpDir = join(tmpdir(), `pubm-brew-tap-${Date.now()}`);
          const formulaFile = basename(formulaPath);

          // Normalize repo to HTTPS URL
          const isShorthand = /^[^/]+\/[^/]+$/.test(options.repo);
          const repoUrl = isShorthand
            ? `https://github.com/${options.repo}.git`
            : options.repo;

          // Extract owner/repo for gh CLI
          const ownerRepoMatch = repoUrl.match(
            /github\.com[/:]([^/]+\/[^/.]+?)(?:\.git)?$/,
          );
          const ownerRepo = ownerRepoMatch?.[1] ?? options.repo;

          // Embed token in clone URL for CI auth
          let cloneUrl = repoUrl;
          const token = ctx.runtime.pluginTokens?.["brew-github-token"];
          if (token && repoUrl.startsWith("https://github.com/")) {
            cloneUrl = repoUrl.replace(
              "https://github.com/",
              `https://x-access-token:${token}@github.com/`,
            );
          }
          const ghEnv = token
            ? { env: { ...process.env, GH_TOKEN: token } }
            : {};

          execSync(`git clone --depth 1 ${cloneUrl} ${tmpDir}`, {
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
            execSync(`cd ${tmpDir} && git push`, { stdio: "inherit" });
          } catch {
            const branch = `pubm/brew-formula-v${releaseCtx.version}`;
            execSync(`cd ${tmpDir} && git checkout -b ${branch}`, {
              stdio: "inherit",
            });
            execSync(`cd ${tmpDir} && git push origin ${branch}`, {
              stdio: "inherit",
            });
            const prUrl = execSync(
              `gh pr create --repo ${ownerRepo} --title "chore(brew): update formula to ${releaseCtx.version}" --body "Automated formula update by pubm"`,
              { encoding: "utf-8", ...ghEnv },
            ).trim();
            const prNumber = prUrl.match(/\/pull\/(\d+)/)?.[1];
            if (prNumber) {
              const repoFlag = ownerRepo;
              ctx.runtime.rollback.add({
                label: `Close Homebrew tap PR #${prNumber} (${repoFlag})`,
                fn: async () => {
                  execSync(
                    `gh pr close ${prNumber} --repo ${repoFlag} --comment "Closed by pubm rollback"`,
                    { stdio: "inherit", ...ghEnv },
                  );
                },
                confirm: true,
              });
            }
            console.log(`Created PR on branch ${branch}`);
          }
        }
      },
    },
  };
}
