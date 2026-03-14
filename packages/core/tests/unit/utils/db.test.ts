import { beforeEach, describe, expect, it, vi } from "vitest";

const store: Record<string, string> = {};

function defaultStatSync(p: string) {
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
}

function defaultWriteFileSync(filePath: string, data: unknown) {
  store[filePath] = typeof data === "string" ? data : (data?.toString() ?? "");
}

function defaultReadFileSync(filePath: string) {
  if (!(filePath in store)) throw new Error("ENOENT");
  return Buffer.from(store[filePath]);
}

vi.mock("node:fs", () => {
  return {
    statSync: vi.fn(defaultStatSync),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(defaultWriteFileSync),
    readFileSync: vi.fn(defaultReadFileSync),
  };
});

let Db: typeof import("../../../src/utils/db.js").Db;

beforeEach(async () => {
  for (const key of Object.keys(store)) {
    delete store[key];
  }
  vi.clearAllMocks();

  const { mkdirSync, readFileSync, statSync, writeFileSync } = await import(
    "node:fs"
  );
  vi.mocked(statSync).mockImplementation(defaultStatSync as any);
  vi.mocked(mkdirSync).mockImplementation(() => undefined);
  vi.mocked(writeFileSync).mockImplementation(defaultWriteFileSync as any);
  vi.mocked(readFileSync).mockImplementation(defaultReadFileSync as any);

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

    it("returns null without warning when file does not exist", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const db = new Db();

      const result = db.get("nonexistent-field");

      expect(result).toBeNull();
      expect(warnSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it("returns null when stored data is corrupted", async () => {
      const { writeFileSync: mockWriteFileSync } = await import("node:fs");
      const db = new Db();

      // Write corrupted data directly to the file path
      db.set("corrupt-field", "valid-value");

      // Now corrupt the stored file by writing invalid data
      const calls = vi.mocked(mockWriteFileSync).mock.calls;
      const lastFilePath = calls[calls.length - 1][0] as string;
      store[lastFilePath] = "not-valid-hex-data";

      const result = db.get("corrupt-field");

      expect(result).toBeNull();
    });
  });

  describe("set error handling", () => {
    it("throws descriptive error when writeFileSync fails", async () => {
      const { writeFileSync: mockWriteFileSync } = await import("node:fs");
      vi.mocked(mockWriteFileSync).mockImplementation(() => {
        throw new Error("EACCES: permission denied");
      });

      const db = new Db();

      expect(() => db.set("token", "value")).toThrow(
        "Failed to save token for 'token'",
      );

      // Restore writeFileSync for other tests
      vi.mocked(mockWriteFileSync).mockImplementation(
        defaultWriteFileSync as any,
      );
    });

    it("includes raw value when writeFileSync throws a non-Error", async () => {
      const { writeFileSync: mockWriteFileSync } = await import("node:fs");
      vi.mocked(mockWriteFileSync).mockImplementation(() => {
        throw "raw write error";
      });

      const db = new Db();

      expect(() => db.set("token", "value")).toThrow(
        "Failed to save token for 'token'",
      );

      vi.mocked(mockWriteFileSync).mockImplementation(
        defaultWriteFileSync as any,
      );
    });
  });

  describe("constructor error handling", () => {
    it("throws descriptive error when mkdirSync fails", async () => {
      const { mkdirSync: mockMkdirSync } = await import("node:fs");
      vi.mocked(mockMkdirSync).mockImplementation(() => {
        throw new Error("EACCES: permission denied");
      });

      vi.resetModules();
      const mod = await import("../../../src/utils/db.js");

      expect(() => new mod.Db()).toThrow(
        "Failed to create token storage directory",
      );
    });

    it("includes raw value when mkdirSync throws a non-Error", async () => {
      const { mkdirSync: mockMkdirSync } = await import("node:fs");
      vi.mocked(mockMkdirSync).mockImplementation(() => {
        throw "raw string error";
      });

      vi.resetModules();
      const mod = await import("../../../src/utils/db.js");

      expect(() => new mod.Db()).toThrow(
        "Failed to create token storage directory",
      );
    });
  });
});
