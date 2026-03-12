import path from "node:path";
import process from "node:process";
import type { BumpType, Release } from "@pubm/core";
import { discoverPackages, getPackageJson, writeChangeset } from "@pubm/core";
import type { Command } from "commander";
import Enquirer from "enquirer";

export function registerAddCommand(parent: Command): void {
  parent
    .command("add")
    .description("Create a new changeset")
    .option("--empty", "Create an empty changeset")
    .option("--packages <list>", "Comma-separated package names")
    .option("--bump <type>", "Bump type: patch, minor, major")
    .option("--message <text>", "Changeset summary")
    .action(
      async (options: {
        empty?: boolean;
        packages?: string;
        bump?: string;
        message?: string;
      }) => {
        if (options.empty) {
          const filePath = writeChangeset([], "");
          console.log(`Created empty changeset: ${filePath}`);
          return;
        }

        if (options.packages && options.bump && options.message) {
          const VALID_BUMP_TYPES = new Set(["patch", "minor", "major"]);
          if (!VALID_BUMP_TYPES.has(options.bump)) {
            throw new Error(
              `Invalid bump type "${options.bump}". Expected: patch, minor, or major.`,
            );
          }
          const packages = options.packages
            .split(",")
            .map((p: string) => p.trim());
          const releases = packages.map((name: string) => ({
            name,
            type: options.bump as BumpType,
          }));
          const filePath = writeChangeset(releases, options.message);
          console.log(`Created changeset: ${filePath}`);
          return;
        }

        // Interactive mode
        const cwd = process.cwd();
        const discovered = discoverPackages({ cwd });

        interface PackageInfo {
          name: string;
          version: string;
        }

        let availablePackages: PackageInfo[];

        if (discovered.length > 0) {
          // Monorepo: read each discovered package's name and version
          const pkgInfos = await Promise.all(
            discovered.map(async (pkg) => {
              const pkgCwd = path.resolve(cwd, pkg.path);
              try {
                const json = await getPackageJson({ cwd: pkgCwd });
                return {
                  name: json.name ?? pkg.path,
                  version: json.version ?? "0.0.0",
                };
              } catch {
                return { name: pkg.path, version: "0.0.0" };
              }
            }),
          );
          availablePackages = pkgInfos;
        } else {
          // Single package
          const json = await getPackageJson({ cwd });
          availablePackages = [
            { name: json.name ?? "unknown", version: json.version ?? "0.0.0" },
          ];
        }

        // Step 1: Package selection
        let selectedPackages: PackageInfo[];

        if (availablePackages.length === 1) {
          selectedPackages = availablePackages;
          const pkg = selectedPackages[0];
          console.log(`\u{1F4E6} ${pkg.name} (v${pkg.version})`);
        } else {
          const choices = availablePackages.map((pkg) => ({
            name: pkg.name,
            message: `${pkg.name} (v${pkg.version})`,
            value: pkg.name,
          }));

          const { packages: selectedNames } = await Enquirer.prompt<{
            packages: string[];
          }>({
            type: "multiselect",
            name: "packages",
            message: "Which packages would you like to include?",
            choices,
          });

          if (selectedNames.length === 0) {
            console.log("No packages selected. Aborting.");
            return;
          }

          selectedPackages = availablePackages.filter((pkg) =>
            selectedNames.includes(pkg.name),
          );
        }

        // Step 2: Bump type selection per package
        const bumpChoices = [
          { name: "patch", message: "patch \u2014 Bug fixes, no API changes" },
          {
            name: "minor",
            message: "minor \u2014 New features, backward compatible",
          },
          { name: "major", message: "major \u2014 Breaking changes" },
        ];

        const releases: Release[] = [];

        for (const pkg of selectedPackages) {
          const { bump: bumpType } = await Enquirer.prompt<{
            bump: string;
          }>({
            type: "select",
            name: "bump",
            message: `Select bump type for ${pkg.name}`,
            choices: bumpChoices,
          });

          releases.push({ name: pkg.name, type: bumpType as BumpType });
        }

        // Step 3: Summary input
        const { summary } = await Enquirer.prompt<{ summary: string }>({
          type: "input",
          name: "summary",
          message: "Summary of changes",
        });

        // Step 4: Write changeset
        const filePath = writeChangeset(releases, summary, cwd);

        // Step 5: Success output
        console.log(`Created changeset: ${filePath}`);
      },
    );
}
