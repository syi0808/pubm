import { beforeEach, describe, expect, it, vi } from "vitest";

const { dbStore, dbControl } = vi.hoisted(() => ({
  dbStore: {} as Record<string, string>,
  dbControl: { available: true },
}));

vi.mock("../../../src/utils/db.js", () => ({
  Db: class MockDb {
    get(field: string): string | null {
      if (!dbControl.available) throw new Error("db unavailable");
      return dbStore[field] ?? null;
    }
    set(field: string, value: unknown): void {
      if (!dbControl.available) throw new Error("db unavailable");
      dbStore[field] = `${value}`;
    }
  },
}));

let SecureStore: typeof import("../../../src/utils/secure-store.js").SecureStore;

beforeEach(async () => {
  for (const key of Object.keys(dbStore)) delete dbStore[key];
  dbControl.available = true;
  vi.resetModules();
  const mod = await import("../../../src/utils/secure-store.js");
  SecureStore = mod.SecureStore;
});

describe("SecureStore", () => {
  describe("get", () => {
    it("returns value from Db", () => {
      dbStore["test-field"] = "db-value";

      const store = new SecureStore();
      expect(store.get("test-field")).toBe("db-value");
    });

    it("returns null when Db has no value", () => {
      const store = new SecureStore();
      expect(store.get("nonexistent")).toBeNull();
    });

    it("returns null when Db throws", () => {
      dbControl.available = false;

      const store = new SecureStore();
      expect(store.get("test-field")).toBeNull();
    });
  });

  describe("set", () => {
    it("stores value in Db", () => {
      const store = new SecureStore();
      store.set("field", "secret");

      expect(dbStore.field).toBe("secret");
    });

    it("converts non-string values to string", () => {
      const store = new SecureStore();
      store.set("num", 42);

      expect(dbStore.num).toBe("42");
    });

    it("throws when Db is unavailable", () => {
      dbControl.available = false;

      const store = new SecureStore();
      expect(() => store.set("field", "value")).toThrow("db unavailable");
    });
  });
});
