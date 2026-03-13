import type { ResolvedPubmConfig } from "@pubm/core";
import type { Command } from "commander";
import { registerAddCommand } from "./add.js";
import { registerChangelogCommand } from "./changelog.js";
import { registerMigrateCommand } from "./migrate.js";
import { registerStatusCommand } from "./status.js";
import { registerVersionCommand } from "./version-cmd.js";

export function registerChangesetsCommand(
  program: Command,
  getConfig: () => ResolvedPubmConfig,
): void {
  const changesets = program
    .command("changesets")
    .description("Manage changesets");

  registerAddCommand(changesets);
  registerChangelogCommand(changesets);
  registerStatusCommand(changesets);
  registerVersionCommand(changesets, getConfig);
  registerMigrateCommand(changesets);
}
