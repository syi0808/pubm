import type { Command } from "commander";
import { enterPreMode, exitPreMode } from "../prerelease/pre.js";

export function registerPreCommand(parent: Command): void {
  parent
    .command("pre")
    .description("Manage pre-release mode")
    .argument("<action>", '"enter" or "exit"')
    .argument("[tag]", "Pre-release tag (required for enter)")
    .action(async (action: string, tag?: string) => {
      if (action === "enter") {
        if (!tag) {
          console.error("Usage: pubm changesets pre enter <tag>");
          process.exit(1);
        }
        enterPreMode(tag);
        console.log(`Entered pre-release mode (${tag})`);
      } else if (action === "exit") {
        exitPreMode();
        console.log("Exited pre-release mode");
      } else {
        console.error(`Unknown pre action: ${action}. Use "enter" or "exit".`);
        process.exit(1);
      }
    });
}
