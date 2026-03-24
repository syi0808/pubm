import { beforeEach, describe, expect, it, vi } from "vitest";

const { files, DB_PATH } = vi.hoisted(() => ({
  files: {} as Record<string, string>,
  DB_PATH: "/tmp/.pubm",
}));

async function syncMapPath(): Promise<string> {
  const path = await import("node:path");
  return path.join(DB_PATH, "gh-secrets-sync-map");
}

vi.mock("node:fs", () => ({
  readFileSync: vi.fn((filePath: string) => {
    if (!(filePath in files)) {
      throw new Error("ENOENT");
    }

    return files[filePath];
  }),
  writeFileSync: vi.fn((filePath: string, value: string) => {
    files[filePath] = value;
  }),
}));

vi.mock("../../../src/utils/db.js", () => ({
  Db: class MockDb {
    path = DB_PATH;
  },
}));

let readGhSecretsSyncHash: typeof import("../../../src/utils/gh-secrets-sync-state.js").readGhSecretsSyncHash;
let writeGhSecretsSyncHash: typeof import("../../../src/utils/gh-secrets-sync-state.js").writeGhSecretsSyncHash;

beforeEach(async () => {
  for (const key of Object.keys(files)) {
    delete files[key];
  }

  vi.clearAllMocks();
  vi.resetModules();

  const mod = await import("../../../src/utils/gh-secrets-sync-state.js");
  readGhSecretsSyncHash = mod.readGhSecretsSyncHash;
  writeGhSecretsSyncHash = mod.writeGhSecretsSyncHash;
});

describe("gh-secrets-sync-state", () => {
  it("returns null when the sync map file does not exist", () => {
    expect(readGhSecretsSyncHash("owner/repo")).toBeNull();
  });

  it("reads a stored sync hash for a specific repo", async () => {
    files[await syncMapPath()] = JSON.stringify({ "owner/repo": "abc123" });

    expect(readGhSecretsSyncHash("owner/repo")).toBe("abc123");
  });

  it("returns null for a repo not in the map", async () => {
    files[await syncMapPath()] = JSON.stringify({ "other/repo": "abc123" });

    expect(readGhSecretsSyncHash("owner/repo")).toBeNull();
  });

  it("returns null when the sync map file contains invalid JSON", async () => {
    files[await syncMapPath()] = "not-json";

    expect(readGhSecretsSyncHash("owner/repo")).toBeNull();
  });

  it("writes the sync hash for a specific repo", async () => {
    writeGhSecretsSyncHash("owner/repo", "def456");

    expect(JSON.parse(files[await syncMapPath()])).toEqual({
      "owner/repo": "def456",
    });
  });

  it("preserves existing entries when writing a new repo", async () => {
    files[await syncMapPath()] = JSON.stringify({ "other/repo": "existing" });

    writeGhSecretsSyncHash("owner/repo", "new123");

    expect(JSON.parse(files[await syncMapPath()])).toEqual({
      "other/repo": "existing",
      "owner/repo": "new123",
    });
  });

  it("updates an existing repo entry", async () => {
    files[await syncMapPath()] = JSON.stringify({ "owner/repo": "old" });

    writeGhSecretsSyncHash("owner/repo", "new");

    expect(JSON.parse(files[await syncMapPath()])).toEqual({
      "owner/repo": "new",
    });
  });

  it("stores independent hashes for different repos", async () => {
    writeGhSecretsSyncHash("owner/repo-a", "hash-a");
    writeGhSecretsSyncHash("owner/repo-b", "hash-b");

    expect(readGhSecretsSyncHash("owner/repo-a")).toBe("hash-a");
    expect(readGhSecretsSyncHash("owner/repo-b")).toBe("hash-b");
  });
});
