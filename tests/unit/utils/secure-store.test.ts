import { beforeEach, describe, expect, it, vi } from "vitest";

const { keyringStore, dbStore, keyringControl } = vi.hoisted(() => ({
  keyringStore: {} as Record<string, string>,
  dbStore: {} as Record<string, string>,
  keyringControl: { available: true },
}));

vi.mock("@napi-rs/keyring", () => ({
  Entry: class MockEntry {
    private key: string;
    constructor(service: string, account: string) {
      if (!keyringControl.available) throw new Error("keyring unavailable");
      this.key = `${service}:${account}`;
    }
    getPassword(): string | null {
      return keyringStore[this.key] ?? null;
    }
    setPassword(value: string): void {
      keyringStore[this.key] = value;
    }
  },
}));

vi.mock("../../../src/utils/db.js", () => ({
  Db: class MockDb {
    get(field: string): string | null {
      return dbStore[field] ?? null;
    }
    set(field: string, value: unknown): void {
      dbStore[field] = `${value}`;
    }
  },
}));

let SecureStore: typeof import("../../../src/utils/secure-store.js").SecureStore;

beforeEach(async () => {
  for (const key of Object.keys(keyringStore)) delete keyringStore[key];
  for (const key of Object.keys(dbStore)) delete dbStore[key];
  keyringControl.available = true;
  vi.resetModules();
  const mod = await import("../../../src/utils/secure-store.js");
  SecureStore = mod.SecureStore;
});

describe("SecureStore", () => {
  describe("get", () => {
    it("returns value from keyring when available", () => {
      keyringStore["pubm:test-field"] = "keyring-value";

      const store = new SecureStore();
      expect(store.get("test-field")).toBe("keyring-value");
    });

    it("falls back to Db when keyring returns null", () => {
      dbStore["test-field"] = "db-value";

      const store = new SecureStore();
      expect(store.get("test-field")).toBe("db-value");
    });

    it("falls back to Db when keyring throws", () => {
      keyringControl.available = false;
      dbStore["test-field"] = "db-fallback";

      const store = new SecureStore();
      expect(store.get("test-field")).toBe("db-fallback");
    });

    it("returns null when both keyring and Db have no value", () => {
      const store = new SecureStore();
      expect(store.get("nonexistent")).toBeNull();
    });

    it("prefers keyring over Db when both have values", () => {
      keyringStore["pubm:field"] = "keyring";
      dbStore.field = "db";

      const store = new SecureStore();
      expect(store.get("field")).toBe("keyring");
    });
  });

  describe("set", () => {
    it("stores value in keyring", () => {
      const store = new SecureStore();
      store.set("field", "secret");

      expect(keyringStore["pubm:field"]).toBe("secret");
    });

    it("falls back to Db when keyring throws", () => {
      keyringControl.available = false;

      const store = new SecureStore();
      store.set("field", "fallback-value");

      expect(dbStore.field).toBe("fallback-value");
    });

    it("converts non-string values to string", () => {
      const store = new SecureStore();
      store.set("num", 42);

      expect(keyringStore["pubm:num"]).toBe("42");
    });

    it("does not write to Db when keyring succeeds", () => {
      const store = new SecureStore();
      store.set("field", "value");

      expect(keyringStore["pubm:field"]).toBe("value");
      expect(dbStore.field).toBeUndefined();
    });
  });
});
