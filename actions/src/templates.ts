import type { Changeset } from "@pubm/core";
import type { ValidationError } from "./validate.js";

const MARKER = "<!-- pubm:changeset-check -->";
const FOOTER =
  '<sub>Validated by <a href="https://github.com/syi0808/pubm/tree/main/actions/changeset-check">pubm changeset check</a></sub>';

export function successBody(changesets: Changeset[]): string {
  const rows = changesets.flatMap((cs) =>
    cs.releases.map((r) => `| \`${cs.id}.md\` | \`${r.path}\` | ${r.type} |`),
  );

  return `${MARKER}
### ✅ Changeset detected

| File | Package | Bump |
|------|---------|------|
${rows.join("\n")}

${FOOTER}`;
}

export function missingBody(skipLabel: string): string {
  return `${MARKER}
### ❌ No changeset found

This PR doesn't include a changeset. If the change affects users, add one by running:

\`\`\`sh
pubm changesets add
\`\`\`

This creates a file in \`.pubm/changesets/\` that describes the change and its semver bump.

If this PR doesn't need a changeset (docs, CI, refactoring, etc.), add the **\`${skipLabel}\`** label to skip this check.

${FOOTER}`;
}

export function invalidBody(errors: ValidationError[]): string {
  const rows = errors.map((e) => `| \`${e.file}\` | ${e.message} |`);

  return `${MARKER}
### ❌ Invalid changeset(s)

These changeset files have validation errors:

| File | Error |
|------|-------|
${rows.join("\n")}

Fix these and push again.

${FOOTER}`;
}

export function skippedBody(label: string): string {
  return `${MARKER}
### ⚠️ Changeset check skipped

The **\`${label}\`** label is on this PR, so no changeset is needed.

${FOOTER}`;
}

export { MARKER };
