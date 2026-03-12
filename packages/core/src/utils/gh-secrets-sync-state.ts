import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Db } from "./db.js";

const SYNC_HASH_FILENAME = "gh-secrets-sync-hash";

function syncHashFilePath(): string {
  return path.resolve(new Db().path, SYNC_HASH_FILENAME);
}

export function readGhSecretsSyncHash(): string | null {
  try {
    const value = readFileSync(syncHashFilePath(), "utf8").trim();
    return value || null;
  } catch {
    return null;
  }
}

export function writeGhSecretsSyncHash(hash: string): void {
  writeFileSync(syncHashFilePath(), `${hash}\n`, "utf8");
}
