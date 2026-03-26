import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { type PubmPlugin, resolvePhases } from "@pubm/core";
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
    credentials: (ctx) => {
      // PAT is only needed in CI where interactive gh auth is unavailable
      if (ctx.options.mode !== "ci") return [];
      return [
        {
          key: "brew-github-token",
          env: "PUBM_BREW_GITHUB_TOKEN",
          label: "GitHub PAT for Homebrew (homebrew-core)",
          tokenUrl:
            "https://github.com/settings/tokens/new?scopes=repo,workflow",
          tokenUrlLabel: "github.com",
          ghSecretName: "PUBM_BREW_GITHUB_TOKEN",
          required: true,
        },
      ];
    },
    checks: (ctx) => {
      const phases = resolvePhases(ctx.options);
      if (!phases.includes("publish") && ctx.options.mode !== "ci") return [];

      // CI: verify PAT exists
      if (ctx.options.mode === "ci") {
        return [
          {
            title: "Checking Homebrew core token availability",
            phase: "conditions" as const,
            task: async (ctx, task) => {
              const token = ctx.runtime.pluginTokens?.["brew-github-token"];
              if (!token) {
                throw new Error(
                  "PUBM_BREW_GITHUB_TOKEN is required for homebrew-core publishing.",
                );
              }
              task.output = "Homebrew core token verified";
            },
          },
        ];
      }

      // Local: verify gh auth + homebrew-core access (needed for fork + PR)
      return [
        {
          title: "Checking GitHub CLI access for homebrew-core",
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

            try {
              execFileSync(
                "gh",
                ["repo", "view", "homebrew/homebrew-core", "--json", "name"],
                { stdio: "pipe" },
              );
              task.output = "Access to homebrew/homebrew-core verified";
            } catch {
              throw new Error(
                "Cannot access homebrew/homebrew-core. Check your GitHub permissions.",
              );
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

        const token = ctx.runtime.pluginTokens?.["brew-github-token"];
        const ghEnv = token ? { env: { ...process.env, GH_TOKEN: token } } : {};

        // Fork homebrew-core if needed
        try {
          execSync("gh repo fork homebrew/homebrew-core --clone=false", {
            stdio: "pipe",
            ...ghEnv,
          });
        } catch {
          // Fork may already exist
        }

        // Get the user's GitHub username for the fork
        const username = execSync("gh api user --jq .login", {
          encoding: "utf-8",
          ...ghEnv,
        }).trim();

        // Clone the fork
        const tmpDir = join(tmpdir(), `pubm-brew-core-${Date.now()}`);
        let cloneUrl = `https://github.com/${username}/homebrew-core.git`;
        if (token) {
          cloneUrl = `https://x-access-token:${token}@github.com/${username}/homebrew-core.git`;
        }
        execSync(`git clone --depth 1 ${cloneUrl} ${tmpDir}`, {
          stdio: "inherit",
        });
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

        try {
          const prUrl = execSync(
            [
              `cd ${tmpDir}`,
              `gh pr create --repo homebrew/homebrew-core --title "${name} ${releaseCtx.version}" --body "Update ${name} formula to version ${releaseCtx.version}"`,
            ].join(" && "),
            { encoding: "utf-8", ...ghEnv },
          ).trim();

          const prNumber = prUrl.match(/\/pull\/(\d+)/)?.[1];
          if (prNumber) {
            ctx.runtime.rollback.add({
              label: `Close homebrew-core PR #${prNumber}`,
              fn: async () => {
                const { execSync: execSyncRb } = await import(
                  "node:child_process"
                );
                execSyncRb(
                  `gh pr close ${prNumber} --repo homebrew/homebrew-core --comment "Closed by pubm rollback"`,
                  { stdio: "inherit", ...ghEnv },
                );
              },
              confirm: true,
            });
          }

          console.log(
            `PR created to homebrew/homebrew-core for ${name} ${releaseCtx.version}`,
          );
        } catch {
          console.warn(
            `⚠ Failed to create PR. Push succeeded to branch: ${branchName}`,
          );
        }
      },
    },
  };
}
