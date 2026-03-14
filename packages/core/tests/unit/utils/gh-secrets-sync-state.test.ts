import { beforeEach, describe, expect, it, vi } from "vitest";

const { files, DB_PATH } = vi.hoisted(() => ({
  files: {} as Record<string, string>,
  DB_PATH: "/tmp/.pubm",
}));

async function syncHashPath(): Promise<string> {
  const path = await import("node:path");
  return path.join(DB_PATH, "gh-secrets-sync-hash");
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
  it("returns null when the sync hash file does not exist", () => {
    expect(readGhSecretsSyncHash()).toBeNull();
  });

  it("reads a stored sync hash from ~/.pubm", async () => {
    files[await syncHashPath()] = "abc123\n";

    expect(readGhSecretsSyncHash()).toBe("abc123");
  });

  it("returns null when the sync hash file contains only whitespace", async () => {
    files[await syncHashPath()] = "  \n  ";

    expect(readGhSecretsSyncHash()).toBeNull();
  });

  it("writes the sync hash into ~/.pubm", async () => {
    writeGhSecretsSyncHash("def456");

    expect(files[await syncHashPath()]).toBe("def456\n");
  });
});
