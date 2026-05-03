import {
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import type { Changeset, Release } from "../../changeset/parser.js";
import { parseChangeset } from "../../changeset/parser.js";
import { generateChangesetContent } from "../../changeset/writer.js";
import { packageKey } from "../../utils/package-key.js";

export interface ConsumeChangesetsForScopeInput {
  cwd: string;
  packageKeys: ReadonlySet<string>;
  resolver: (key: string) => string;
  directory?: string;
}

export interface ConsumeChangesetsForScopeResult {
  consumed: Changeset[];
  rewrittenFiles: string[];
  deletedFiles: string[];
}

export function consumeChangesetsForScope({
  cwd,
  packageKeys,
  resolver,
  directory = ".pubm/changesets",
}: ConsumeChangesetsForScopeInput): ConsumeChangesetsForScopeResult {
  const changesetsDir = path.resolve(cwd, directory);
  const result: ConsumeChangesetsForScopeResult = {
    consumed: [],
    rewrittenFiles: [],
    deletedFiles: [],
  };

  if (!existsSync(changesetsDir)) return result;

  for (const file of readdirSync(changesetsDir).sort()) {
    if (!file.endsWith(".md") || file === "README.md") continue;

    const filePath = path.join(changesetsDir, file);
    const content = readFileSync(filePath, "utf-8");
    const changeset = parseChangeset(content, file, resolver);
    const consumed: Release[] = [];
    const remaining: Release[] = [];

    for (const release of changeset.releases) {
      const key = keyForRelease(release, resolver);
      if (packageKeys.has(key)) {
        consumed.push(release);
      } else {
        remaining.push(release);
      }
    }

    if (consumed.length === 0) continue;

    result.consumed.push({ ...changeset, releases: consumed });

    if (remaining.length === 0) {
      rmSync(filePath);
      result.deletedFiles.push(filePath);
    } else {
      writeFileSync(
        filePath,
        generateChangesetContent(remaining, changeset.summary),
        "utf-8",
      );
      result.rewrittenFiles.push(filePath);
    }
  }

  return result;
}

function keyForRelease(
  release: Release,
  resolver: (key: string) => string,
): string {
  return release.ecosystem
    ? packageKey({ path: release.path, ecosystem: release.ecosystem })
    : resolver(release.path);
}
