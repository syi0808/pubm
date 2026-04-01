import type { ResolvedPubmConfig } from "@pubm/core";
import { t } from "@pubm/core";
import type { Command } from "commander";
import { registerAddCommand } from "./add.js";
import { registerChangelogCommand } from "./changelog.js";
import { registerStatusCommand } from "./status.js";
import { registerVersionCommand } from "./version-cmd.js";

export function registerChangesetsCommand(
  program: Command,
  getConfig: () => ResolvedPubmConfig,
): void {
  const changesets = program
    .command("changesets")
    .description(t("cmd.changesets.description"));

  registerAddCommand(changesets, getConfig);
  registerChangelogCommand(changesets);
  registerStatusCommand(changesets);
  registerVersionCommand(changesets, getConfig);
}
