import { PUBM_VERSION, t, ui } from "@pubm/core";
import type { Command } from "commander";
import { UpdateKit } from "update-kit";

export function registerUpdateCommand(parent: Command): void {
  parent
    .command("update")
    .description(t("cmd.update.description"))
    .action(async (): Promise<void> => {
      const kit = await UpdateKit.create({
        appName: "pubm",
        currentVersion: PUBM_VERSION,
        sources: [{ type: "npm", packageName: "pubm" }],
        delegateMode: "execute",
      });

      const result = await kit.autoUpdate({
        onProgress: (p) => {
          if (p.phase === "downloading" && p.totalBytes) {
            const pct = Math.round((p.bytesDownloaded / p.totalBytes) * 100);
            process.stderr.write(
              `\r${t("cmd.update.downloading", { percent: pct })}`,
            );
          } else {
            console.error(`${p.phase}...`);
          }
        },
      });

      switch (result.kind) {
        case "success":
          ui.success(
            t("cmd.update.success", {
              from: result.fromVersion,
              to: result.toVersion,
            }),
          );
          break;
        case "needs-restart":
          console.log(result.message);
          break;
        case "failed":
          ui.error(t("error.update.failed", { message: result.error.message }));
          process.exitCode = 1;
          break;
      }
    });
}
