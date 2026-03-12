import { beforeEach, describe, expect, it, vi } from "vitest";

const { dbStore, dbControl, keyringStore, keyringControl } = vi.hoisted(() => ({
  dbStore: {} as Record<string, string>,
  dbControl: { available: true },
  keyringStore: {} as Record<string, string>,
  keyringControl: { installed: true, available: true },
}));

vi.mock("node:module", () => ({
  createRequire: () => (specifier: string) => {
    if (specifier !== "@napi-rs/keyring") {
      throw new Error(`Unexpected module requested: ${specifier}`);
    }

    if (!keyringControl.installed) {
      throw new Error("keyring unavailable");
    }

    return {
      Entry: class MockEntry {
        constructor(
          _service: string,
          private readonly field: string,
        ) {}

        getPassword(): string | null {
          if (!keyringControl.available) {
            throw new Error("keyring unavailable");
          }

          return keyringStore[this.field] ?? null;
        }

        setPassword(value: string): void {
          if (!keyringControl.available) {
            throw new Error("keyring unavailable");
          }

          keyringStore[this.field] = value;
        }
      },
    };
  },
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
  for (const key of Object.keys(keyringStore)) delete keyringStore[key];
  dbControl.available = true;
  keyringControl.installed = true;
  keyringControl.available = true;
  vi.resetModules();
  const mod = await import("../../../src/utils/secure-store.js");
  SecureStore = mod.SecureStore;
});

describe("SecureStore", () => {
  describe("get", () => {
    it("prefers keyring for token fields", () => {
      keyringStore["test-token"] = "keyring-value";
      dbStore["test-token"] = "db-value";

      const store = new SecureStore();
      expect(store.get("test-token")).toBe("keyring-value");
    });

    it("falls back to Db when keyring is unavailable", () => {
      keyringControl.installed = false;
      dbStore["test-token"] = "db-value";

      const store = new SecureStore();
      expect(store.get("test-token")).toBe("db-value");
    });

    it("migrates Db-only tokens into keyring on read", () => {
      dbStore["test-token"] = "db-value";

      const store = new SecureStore();

      expect(store.get("test-token")).toBe("db-value");
      expect(keyringStore["test-token"]).toBe("db-value");
    });

    it("uses Db directly for non-token fields", () => {
      keyringStore["gh-secrets-sync-hash"] = "keyring-value";
      dbStore["gh-secrets-sync-hash"] = "db-value";

      const store = new SecureStore();
      expect(store.get("gh-secrets-sync-hash")).toBe("db-value");
    });

    it("returns null when keyring and Db are unavailable", () => {
      keyringControl.installed = false;
      dbControl.available = false;

      const store = new SecureStore();
      expect(store.get("test-token")).toBeNull();
    });
  });

  describe("set", () => {
    it("stores token values in keyring", () => {
      const store = new SecureStore();
      store.set("field-token", "secret");

      expect(keyringStore["field-token"]).toBe("secret");
      expect(dbStore["field-token"]).toBeUndefined();
    });

    it("converts non-string values to string", () => {
      const store = new SecureStore();
      store.set("num-token", 42);

      expect(keyringStore["num-token"]).toBe("42");
    });

    it("falls back to Db when keyring write fails", () => {
      keyringControl.available = false;

      const store = new SecureStore();
      store.set("field-token", "value");

      expect(dbStore["field-token"]).toBe("value");
    });

    it("stores non-token values in Db", () => {
      const store = new SecureStore();
      store.set("gh-secrets-sync-hash", "hash-value");

      expect(dbStore["gh-secrets-sync-hash"]).toBe("hash-value");
      expect(keyringStore["gh-secrets-sync-hash"]).toBeUndefined();
    });

    it("throws when Db fallback is unavailable", () => {
      keyringControl.installed = false;
      dbControl.available = false;

      const store = new SecureStore();
      expect(() => store.set("field-token", "value")).toThrow("db unavailable");
    });
  });
});
