import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { type Changeset, parseChangeset } from "@pubm/core";

export interface ValidationError {
  file: string;
  message: string;
}

export interface ValidationResult {
  valid: Changeset[];
  errors: ValidationError[];
}

export function validateChangesets(
  files: string[],
  cwd: string,
  resolveKey?: (key: string) => string | undefined,
): ValidationResult {
  const valid: Changeset[] = [];
  const errors: ValidationError[] = [];

  for (const file of files) {
    const filePath = path.join(cwd, file);
    const fileName = path.basename(file);

    let content: string;
    try {
      content = readFileSync(filePath, "utf8");
    } catch {
      errors.push({ file: fileName, message: "File could not be read" });
      continue;
    }

    let changeset: Changeset;
    try {
      changeset = parseChangeset(content, fileName, resolveKey);
    } catch (err) {
      errors.push({
        file: fileName,
        message: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    if (changeset.releases.length === 0) {
      errors.push({
        file: fileName,
        message: "No package releases defined in frontmatter",
      });
      continue;
    }

    if (!changeset.summary.trim()) {
      errors.push({
        file: fileName,
        message: "Changeset summary is empty",
      });
      continue;
    }

    for (const release of changeset.releases) {
      const pkgPath = path.join(cwd, release.path);
      if (!existsSync(pkgPath)) {
        errors.push({
          file: fileName,
          message: `Package path "${release.path}" does not exist`,
        });
      }
    }

    if (!errors.some((e) => e.file === fileName)) {
      valid.push(changeset);
    }
  }

  return { valid, errors };
}
