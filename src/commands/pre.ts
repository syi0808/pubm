import type { CAC } from "cac";
import { enterPreMode, exitPreMode } from "../prerelease/pre.js";

export function registerPreCommand(cli: CAC): void {
  cli
    .command("pre <action> [tag]", "Manage pre-release mode")
    .action(async (action: string, tag?: string) => {
      if (action === "enter") {
        if (!tag) {
          console.error("Usage: pubm pre enter <tag>");
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
