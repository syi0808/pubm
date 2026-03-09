import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { SyncTarget } from "./types.js";
import { isJsonTarget } from "./types.js";

function setNestedValue(
  obj: Record<string, unknown>,
  path: string,
  value: unknown,
  filePath: string,
): void {
  const keys = path.split(".");
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const next = current[keys[i]];
    if (next == null || typeof next !== "object") {
      throw new Error(
        `Invalid path "${path}" in ${filePath}: key "${keys[i]}" is not an object`,
      );
    }
    current = next as Record<string, unknown>;
  }
  current[keys[keys.length - 1]] = value;
}

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const keys = path.split(".");
  let current: unknown = obj;
  for (const key of keys) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

export function syncVersionInFile(
  filePath: string,
  newVersion: string,
  target: SyncTarget,
): boolean {
  if (!existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  if (isJsonTarget(target)) {
    const content = readFileSync(filePath, "utf-8");
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(content) as Record<string, unknown>;
    } catch (error) {
      throw new Error(
        `Failed to parse JSON in ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const currentValue = getNestedValue(json, target.jsonPath);
    if (currentValue === newVersion) return false;

    setNestedValue(json, target.jsonPath, newVersion, filePath);
    const indent = content.match(/^\s+/m)?.[0] ?? "  ";
    writeFileSync(filePath, `${JSON.stringify(json, null, indent)}\n`, "utf-8");
    return true;
  }

  // Regex target
  const content = readFileSync(filePath, "utf-8");
  const pattern = new RegExp(target.pattern.source, target.pattern.flags);
  const updated = content.replace(pattern, (match) => {
    return match.replace(/\d+\.\d+\.\d+(?:-[\w.]+)?/, newVersion);
  });

  if (updated === content) return false;
  writeFileSync(filePath, updated, "utf-8");
  return true;
}
