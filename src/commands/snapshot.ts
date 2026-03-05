import type { CAC } from "cac";

export function registerSnapshotCommand(cli: CAC): void {
  cli
    .command("snapshot [tag]", "Create a snapshot release")
    .action(async (tag?: string) => {
      console.log(`pubm snapshot ${tag ?? ""} — coming in next phase`);
    });
}
