import type { PubmConfig } from "../config/types.js";

const CONFIG_KEY_ORDER: (keyof PubmConfig)[] = [
  "versioning",
  "branch",
  "packages",
  "changelog",
  "changelogFormat",
  "commit",
  "access",
  "tag",
  "contents",
  "releaseDraft",
  "releaseNotes",
  "fixed",
  "linked",
  "updateInternalDependencies",
  "ignore",
  "validate",
  "saveToken",
  "snapshotTemplate",
  "lockfileSync",
  "rollback",
  "rollbackStrategy",
  "compress",
  "releaseAssets",
  "excludeRelease",
  "locale",
  "versionSources",
  "conventionalCommits",
  "plugins",
];

function isShortPrimitiveArray(arr: unknown[]): boolean {
  if (arr.length > 3) return false;
  return arr.every(
    (item) =>
      typeof item === "string" ||
      typeof item === "number" ||
      typeof item === "boolean",
  );
}

function formatValue(value: unknown, indent: number): string {
  const pad = " ".repeat(indent);
  const innerPad = " ".repeat(indent + 2);

  if (typeof value === "boolean" || typeof value === "number") {
    return String(value);
  }

  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    if (isShortPrimitiveArray(value)) {
      return `[${value.map((v) => formatValue(v, indent)).join(", ")}]`;
    }
    const items = value
      .map((item) => `${innerPad}${formatValue(item, indent + 2)}`)
      .join(",\n");
    return `[\n${items},\n${pad}]`;
  }

  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>).filter(
      ([, v]) => v !== undefined,
    );
    if (entries.length === 0) return "{}";
    const lines = entries
      .map(([k, v]) => {
        const safeKey = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(k)
          ? k
          : JSON.stringify(k);
        return `${innerPad}${safeKey}: ${formatValue(v, indent + 2)}`;
      })
      .join(",\n");
    return `{\n${lines},\n${pad}}`;
  }

  return String(value);
}

export function generateConfigString(config: Partial<PubmConfig>): string {
  const orderedKeys = CONFIG_KEY_ORDER.filter((k) => config[k] !== undefined);

  const remainingKeys = (Object.keys(config) as (keyof PubmConfig)[]).filter(
    (k) => !CONFIG_KEY_ORDER.includes(k) && config[k] !== undefined,
  );

  const allKeys = [...orderedKeys, ...remainingKeys];

  const body = allKeys
    .map((k) => `  ${String(k)}: ${formatValue(config[k], 2)}`)
    .join(",\n");

  return `${[
    'import { defineConfig } from "pubm";',
    "",
    "export default defineConfig({",
    body ? `${body},` : "",
    "});",
  ]
    .filter((line, i, arr) => !(line === "" && arr[i - 1] === ""))
    .join("\n")}\n`;
}
