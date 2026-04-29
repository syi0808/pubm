import process from "node:process";
import type {
  BumpType,
  EcosystemKey,
  Release,
  ResolvedPubmConfig,
} from "@pubm/core";
import {
  createKeyResolver,
  packageKey,
  t,
  ui,
  writeChangeset,
} from "@pubm/core";
import { prompt } from "@pubm/runner";
import type { Command } from "commander";

export function registerAddCommand(
  parent: Command,
  getConfig: () => ResolvedPubmConfig,
): void {
  parent
    .command("add")
    .description(t("cmd.add.description"))
    .option("--empty", t("cmd.add.optionEmpty"))
    .option("--packages <list>", t("cmd.add.optionPackages"))
    .option("--bump <type>", t("cmd.add.optionBump"))
    .option("--message <text>", t("cmd.add.optionMessage"))
    .action(
      async (options: {
        empty?: boolean;
        packages?: string;
        bump?: string;
        message?: string;
      }) => {
        if (options.empty) {
          const filePath = writeChangeset([], "");
          ui.success(t("cmd.add.createdEmpty", { path: filePath }));
          return;
        }

        if (options.packages && options.bump && options.message) {
          const VALID_BUMP_TYPES = new Set(["patch", "minor", "major"]);
          if (!VALID_BUMP_TYPES.has(options.bump)) {
            throw new Error(t("error.add.invalidBump", { type: options.bump }));
          }
          const packages = options.packages
            .split(",")
            .map((p: string) => p.trim());
          const config = getConfig();
          const resolver = createKeyResolver(config.packages);
          const releases = packages.map((input: string) => ({
            path: resolver(input),
            type: options.bump as BumpType,
          }));
          const filePath = writeChangeset(releases, options.message);
          ui.success(t("cmd.add.created", { path: filePath }));
          return;
        }

        // Interactive mode — use resolved config packages
        const cwd = process.cwd();
        const config = getConfig();

        interface PackageInfo {
          name: string;
          path: string;
          version: string;
          ecosystem: EcosystemKey;
        }

        const availablePackages: PackageInfo[] = config.packages.map((p) => ({
          name: p.name,
          path: p.path,
          version: p.version,
          ecosystem: p.ecosystem,
        }));

        // Step 1: Package selection
        let selectedPackages: PackageInfo[];

        if (availablePackages.length === 1) {
          selectedPackages = availablePackages;
          const pkg = selectedPackages[0];
          console.log(`\u{1F4E6} ${pkg.name} (v${pkg.version})`);
        } else {
          const isFixed = config.versioning === "fixed";
          const choices = availablePackages.map((pkg) => {
            const key = packageKey({
              path: pkg.path,
              ecosystem: pkg.ecosystem,
            });
            return {
              name: key,
              message: `${pkg.name} (v${pkg.version}) [${pkg.ecosystem}]`,
              value: key,
            };
          });

          const selectedKeys = await prompt<string[]>({
            type: "multiselect",
            message: t("prompt.add.selectPackages"),
            choices,
            ...(isFixed && {
              initial: availablePackages.map((pkg) =>
                packageKey({
                  path: pkg.path,
                  ecosystem: pkg.ecosystem,
                }),
              ),
            }),
          });

          if (selectedKeys.length === 0) {
            ui.warn(t("cmd.add.noPackages"));
            return;
          }

          const selectedKeySet = new Set(selectedKeys);
          selectedPackages = availablePackages.filter((pkg) =>
            selectedKeySet.has(
              packageKey({ path: pkg.path, ecosystem: pkg.ecosystem }),
            ),
          );
        }

        // Step 2: Bump type selection
        const bumpChoices = [
          { name: "patch", message: t("prompt.add.bumpPatch") },
          { name: "minor", message: t("prompt.add.bumpMinor") },
          { name: "major", message: t("prompt.add.bumpMajor") },
        ];

        const releases: Release[] = [];

        if (config.versioning === "fixed") {
          const bumpType = await prompt<string>({
            type: "select",
            message: t("prompt.add.selectBumpAll"),
            choices: bumpChoices,
          });

          for (const pkg of selectedPackages) {
            releases.push({
              path: pkg.path,
              ecosystem: pkg.ecosystem,
              type: bumpType as BumpType,
            });
          }
        } else {
          for (const pkg of selectedPackages) {
            const bumpType = await prompt<string>({
              type: "select",
              message: t("prompt.add.selectBump", { name: pkg.name }),
              choices: bumpChoices,
            });

            releases.push({
              path: pkg.path,
              ecosystem: pkg.ecosystem,
              type: bumpType as BumpType,
            });
          }
        }

        // Step 3: Summary input
        const summary = await prompt<string>({
          type: "input",
          message: t("prompt.add.summary"),
        });

        // Step 4: Write changeset
        const filePath = writeChangeset(releases, summary, cwd);

        // Step 5: Success output
        ui.success(t("cmd.add.created", { path: filePath }));
      },
    );
}
