import process from "node:process";
import type { BumpType, Release, ResolvedPubmConfig } from "@pubm/core";
import { createKeyResolver, t, ui, writeChangeset } from "@pubm/core";
import type { Command } from "commander";
import Enquirer from "enquirer";

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
        }

        const availablePackages: PackageInfo[] = config.packages.map((p) => ({
          name: p.name,
          path: p.path,
          version: p.version,
        }));

        // Step 1: Package selection
        let selectedPackages: PackageInfo[];

        if (availablePackages.length === 1) {
          selectedPackages = availablePackages;
          const pkg = selectedPackages[0];
          console.log(`\u{1F4E6} ${pkg.name} (v${pkg.version})`);
        } else {
          const isFixed = config.versioning === "fixed";
          const choices = availablePackages.map((pkg) => ({
            name: pkg.name,
            message: `${pkg.name} (v${pkg.version})`,
            value: pkg.name,
            ...(isFixed && { enabled: true }),
          }));

          const { packages: selectedNames } = await Enquirer.prompt<{
            packages: string[];
          }>({
            type: "multiselect",
            name: "packages",
            message: t("prompt.add.selectPackages"),
            choices,
          });

          if (selectedNames.length === 0) {
            ui.warn(t("cmd.add.noPackages"));
            return;
          }

          selectedPackages = availablePackages.filter((pkg) =>
            selectedNames.includes(pkg.name),
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
          const { bump: bumpType } = await Enquirer.prompt<{
            bump: string;
          }>({
            type: "select",
            name: "bump",
            message: t("prompt.add.selectBumpAll"),
            choices: bumpChoices,
          });

          for (const pkg of selectedPackages) {
            releases.push({ path: pkg.path, type: bumpType as BumpType });
          }
        } else {
          for (const pkg of selectedPackages) {
            const { bump: bumpType } = await Enquirer.prompt<{
              bump: string;
            }>({
              type: "select",
              name: "bump",
              message: t("prompt.add.selectBump", { name: pkg.name }),
              choices: bumpChoices,
            });

            releases.push({ path: pkg.path, type: bumpType as BumpType });
          }
        }

        // Step 3: Summary input
        const { summary } = await Enquirer.prompt<{ summary: string }>({
          type: "input",
          name: "summary",
          message: t("prompt.add.summary"),
        });

        // Step 4: Write changeset
        const filePath = writeChangeset(releases, summary, cwd);

        // Step 5: Success output
        ui.success(t("cmd.add.created", { path: filePath }));
      },
    );
}
