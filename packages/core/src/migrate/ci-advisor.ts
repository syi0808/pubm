import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { CiAdvice, MigrationSourceName } from "./types.js";

const CI_PATTERNS: Record<MigrationSourceName, RegExp[]> = {
  "semantic-release": [
    /npx\s+semantic-release/,
    /yarn\s+semantic-release/,
    /pnpm\s+.*semantic-release/,
  ],
  "release-it": [
    /npx\s+release-it/,
    /yarn\s+release-it/,
    /pnpm\s+.*release-it/,
  ],
  changesets: [
    /changeset\s+publish/,
    /changeset\s+version/,
    /changesets\/action/,
  ],
  np: [/npx\s+np\b/, /yarn\s+np\b/],
};

export function scanCiWorkflows(
  cwd: string,
  source: MigrationSourceName,
): CiAdvice[] {
  const workflowsDir = join(cwd, ".github", "workflows");

  if (!existsSync(workflowsDir)) return [];

  const patterns = CI_PATTERNS[source];
  const advice: CiAdvice[] = [];

  const files = readdirSync(workflowsDir, { encoding: "utf-8" });

  for (const filename of files) {
    if (!filename.endsWith(".yml") && !filename.endsWith(".yaml")) continue;

    const filePath = join(workflowsDir, filename);
    const content = readFileSync(filePath, "utf-8");

    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Strip YAML list item prefix ("- ") for cleaner display
      const normalized = trimmed.startsWith("- ") ? trimmed.slice(2) : trimmed;

      for (const pattern of patterns) {
        if (pattern.test(normalized)) {
          advice.push({
            file: filePath,
            removeLine: normalized,
            addLine: "npx pubm release:ci",
          });
          break;
        }
      }
    }
  }

  return advice;
}
