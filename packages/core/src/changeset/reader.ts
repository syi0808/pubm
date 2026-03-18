import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import type { Changeset } from "./parser.js";
import { parseChangeset } from "./parser.js";

export function readChangesets(
  cwd: string = process.cwd(),
  resolveKey?: (key: string) => string,
): Changeset[] {
  const changesetsDir = path.join(cwd, ".pubm", "changesets");

  if (!existsSync(changesetsDir)) {
    return [];
  }

  const files = readdirSync(changesetsDir);

  const changesets: Changeset[] = [];

  for (const file of files) {
    if (!file.endsWith(".md") || file === "README.md") {
      continue;
    }

    const filePath = path.join(changesetsDir, file);
    const content = readFileSync(filePath, "utf-8");
    changesets.push(parseChangeset(content, file, resolveKey));
  }

  return changesets;
}

export function deleteChangesetFiles(
  cwd: string,
  changesets: Changeset[],
): void {
  const changesetsDir = path.join(cwd, ".pubm", "changesets");

  for (const changeset of changesets) {
    const filePath = path.join(changesetsDir, `${changeset.id}.md`);
    if (existsSync(filePath)) {
      rmSync(filePath);
    }
  }
}
