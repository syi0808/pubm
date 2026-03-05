import type { CAC } from "cac";
import { UpdateKit } from "update-kit";

export function registerUpdateCommand(cli: CAC): void {
  cli
    .command("update", "Update pubm to the latest version")
    .action(async (): Promise<void> => {
      const kit = await UpdateKit.create({
        sources: [{ type: "npm", packageName: "pubm" }],
        delegateMode: "execute",
      });

      const result = await kit.autoUpdate({
        onProgress: (p) => {
          if (p.phase === "downloading" && p.totalBytes) {
            const pct = Math.round((p.bytesDownloaded / p.totalBytes) * 100);
            process.stderr.write(`\rDownloading... ${pct}%`);
          } else {
            console.error(`${p.phase}...`);
          }
        },
      });

      switch (result.kind) {
        case "success":
          console.log(
            `Updated from ${result.fromVersion} to ${result.toVersion}`,
          );
          break;
        case "needs-restart":
          console.log(result.message);
          break;
        case "failed":
          console.error(`Update failed: ${result.error.message}`);
          process.exitCode = 1;
          break;
      }
    });
}
