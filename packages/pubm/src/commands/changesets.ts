import type { Command } from "commander";
import { registerAddCommand } from "./add.js";
import { registerChangelogCommand } from "./changelog.js";
import { registerMigrateCommand } from "./migrate.js";
import { registerPreCommand } from "./pre.js";
import { registerSnapshotCommand } from "./snapshot.js";
import { registerStatusCommand } from "./status.js";
import { registerVersionCommand } from "./version-cmd.js";

export function registerChangesetsCommand(program: Command): void {
  const changesets = program
    .command("changesets")
    .description("Manage changesets");

  registerAddCommand(changesets);
  registerChangelogCommand(changesets);
  registerStatusCommand(changesets);
  registerVersionCommand(changesets);
  registerPreCommand(changesets);
  registerSnapshotCommand(changesets);
  registerMigrateCommand(changesets);
}
