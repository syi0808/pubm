import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export function writeChangelogToFile(cwd: string, newContent: string): void {
  const changelogPath = path.join(cwd, "CHANGELOG.md");
  let existing = "";
  if (existsSync(changelogPath)) {
    existing = readFileSync(changelogPath, "utf-8");
  }
  const header = "# Changelog\n\n";
  const doubleNewline = existing.indexOf("\n\n");
  const body =
    existing.startsWith("# Changelog") && doubleNewline !== -1
      ? existing.slice(doubleNewline + 2)
      : existing;
  writeFileSync(changelogPath, `${header}${newContent}\n${body}`, "utf-8");
}
