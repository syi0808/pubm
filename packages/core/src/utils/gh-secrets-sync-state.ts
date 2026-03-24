import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Db } from "./db.js";

const SYNC_MAP_FILENAME = "gh-secrets-sync-map";

function syncMapFilePath(): string {
  return path.join(new Db().path, SYNC_MAP_FILENAME);
}

function readMap(): Record<string, string> {
  try {
    const raw = readFileSync(syncMapFilePath(), "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function readGhSecretsSyncHash(repoSlug: string): string | null {
  const map = readMap();
  return map[repoSlug] ?? null;
}

export function writeGhSecretsSyncHash(repoSlug: string, hash: string): void {
  const map = readMap();
  map[repoSlug] = hash;
  writeFileSync(syncMapFilePath(), JSON.stringify(map), "utf8");
}
