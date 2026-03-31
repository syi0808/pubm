import type { ConventionalCommit } from "./types.js";

const HEADER_REGEX = /^(\w+)(?:\(([^)]+)\))?(!)?\s*:\s*(.+)$/;
const FOOTER_REGEX = /^([\w-]+|BREAKING CHANGE)\s*:\s*(.+)$/;

export function parseConventionalCommit(
  hash: string,
  message: string,
  files: string[] = [],
): ConventionalCommit | null {
  const lines = message.split("\n");
  const firstLine = lines[0];

  const headerMatch = firstLine.match(HEADER_REGEX);
  if (!headerMatch) return null;

  const [, type, scope, bang, description] = headerMatch;

  let body: string | undefined;
  const footers = new Map<string, string>();
  let breaking = bang === "!";

  if (lines.length > 1) {
    const rest = lines.slice(1);

    let footerStartIndex = rest.length;
    for (let i = rest.length - 1; i >= 0; i--) {
      if (rest[i] === "") {
        footerStartIndex = i + 1;
        break;
      }
    }

    const bodyStartIndex = rest.findIndex((line) => line !== "");
    if (bodyStartIndex !== -1 && bodyStartIndex < footerStartIndex) {
      const bodyLines = rest.slice(bodyStartIndex, footerStartIndex - 1);
      const bodyText = bodyLines.join("\n").trim();
      if (bodyText) body = bodyText;
    }

    let currentFooterKey: string | undefined;
    for (let i = footerStartIndex; i < rest.length; i++) {
      const footerMatch = rest[i].match(FOOTER_REGEX);
      if (footerMatch) {
        const [, key, value] = footerMatch;
        footers.set(key, value);
        currentFooterKey = key;
        if (key === "BREAKING CHANGE" || key === "BREAKING-CHANGE") {
          breaking = true;
        }
      } else if (currentFooterKey && rest[i].startsWith("  ")) {
        const existing = footers.get(currentFooterKey) ?? "";
        footers.set(currentFooterKey, `${existing}\n${rest[i].trimStart()}`);
      }
    }
  }

  return { hash, type, scope, breaking, description, body, footers, files };
}
