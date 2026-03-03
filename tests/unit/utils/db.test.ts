import { beforeEach, describe, expect, it, vi } from "vitest";

const store: Record<string, string> = {};

vi.mock("node:fs", () => {
  return {
    statSync: vi.fn((p: string) => {
      if (p.endsWith(".pubm")) {
        throw new Error("ENOENT");
      }
      return {
        rdev: 1,
        birthtimeMs: 1000,
        nlink: 1,
        gid: 0,
        isDirectory: () => true,
      };
    }),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn((filePath: string, data: any) => {
      store[filePath] = typeof data === "string" ? data : data.toString();
    }),
    readFileSync: vi.fn((filePath: string) => {
      if (!(filePath in store)) throw new Error("ENOENT");
      return Buffer.from(store[filePath]);
    }),
  };
});

let Db: typeof import("../../../src/utils/db.js").Db;

beforeEach(async () => {
  for (const key of Object.keys(store)) {
    delete store[key];
  }
  vi.resetModules();
  const mod = await import("../../../src/utils/db.js");
  Db = mod.Db;
});

describe("Db", () => {
  describe("constructor", () => {
    it("creates .pubm directory when it does not exist", async () => {
      const { mkdirSync } = await import("node:fs");

      new Db();

      expect(mkdirSync).toHaveBeenCalled();
    });

    it("calls mkdirSync when path exists but is not a directory", async () => {
      const { statSync, mkdirSync } = await import("node:fs");
      vi.mocked(statSync).mockImplementation((p: any) => {
        if (typeof p === "string" && p.endsWith(".pubm")) {
          return { isDirectory: () => false } as any;
        }
        return {
          rdev: 1,
          birthtimeMs: 1000,
          nlink: 1,
          gid: 0,
          isDirectory: () => true,
        } as any;
      });

      vi.resetModules();
      const mod = await import("../../../src/utils/db.js");
      const callsBefore = vi.mocked(mkdirSync).mock.calls.length;
      new mod.Db();
      const callsAfter = vi.mocked(mkdirSync).mock.calls.length;

      expect(callsAfter).toBeGreaterThan(callsBefore);
    });

    it("handles when directory already exists", async () => {
      const { statSync } = await import("node:fs");
      vi.mocked(statSync).mockImplementation((p: any) => {
        if (typeof p === "string" && p.endsWith(".pubm")) {
          return { isDirectory: () => true } as any;
        }
        return {
          rdev: 1,
          birthtimeMs: 1000,
          nlink: 1,
          gid: 0,
          isDirectory: () => true,
        } as any;
      });

      vi.resetModules();
      const mod = await import("../../../src/utils/db.js");
      const { mkdirSync } = await import("node:fs");

      const callsBefore = vi.mocked(mkdirSync).mock.calls.length;
      new mod.Db();
      const callsAfter = vi.mocked(mkdirSync).mock.calls.length;

      // When directory exists and isDirectory returns true, mkdirSync should not be called
      expect(callsAfter).toBe(callsBefore);
    });
  });

  describe("set and get", () => {
    it("round-trips a value through encrypt and decrypt", () => {
      const db = new Db();

      db.set("token", "my-secret-value");
      const result = db.get("token");

      expect(result).toBe("my-secret-value");
    });

    it("returns null for a non-existent field", () => {
      const db = new Db();

      const result = db.get("nonexistent");

      expect(result).toBeNull();
    });

    it("stores different fields independently", () => {
      const db = new Db();

      db.set("field-a", "value-a");
      db.set("field-b", "value-b");

      expect(db.get("field-a")).toBe("value-a");
      expect(db.get("field-b")).toBe("value-b");
    });

    it("overwrites a previous value for the same field", () => {
      const db = new Db();

      db.set("key", "old");
      db.set("key", "new");

      expect(db.get("key")).toBe("new");
    });
  });
});
