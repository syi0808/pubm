import { createRequire } from "node:module";
import { Db } from "./db.js";

const require = createRequire(import.meta.url);
const KEYRING_SERVICE = "pubm";

interface KeyringEntry {
  getPassword(): string | null;
  setPassword(password: string): void;
  deletePassword(): void;
}

type KeyringEntryConstructor = new (
  service: string,
  username: string,
) => KeyringEntry;

let keyringEntryConstructor: KeyringEntryConstructor | null | undefined;

function usesKeyring(field: string): boolean {
  return field.endsWith("-token");
}

function loadKeyringEntryConstructor(): KeyringEntryConstructor | null {
  if (keyringEntryConstructor !== undefined) return keyringEntryConstructor;

  try {
    const mod = require("@napi-rs/keyring") as {
      Entry?: KeyringEntryConstructor;
    };
    keyringEntryConstructor =
      typeof mod.Entry === "function" ? mod.Entry : null;
  } catch {
    keyringEntryConstructor = null;
  }

  return keyringEntryConstructor;
}

export class SecureStore {
  private db: Db | null = null;

  private getDb(): Db {
    if (!this.db) this.db = new Db();
    return this.db;
  }

  private getKeyringEntry(field: string): KeyringEntry | null {
    if (!usesKeyring(field)) return null;

    const Entry = loadKeyringEntryConstructor();
    if (!Entry) return null;

    try {
      return new Entry(KEYRING_SERVICE, field);
    } catch {
      return null;
    }
  }

  get(field: string): string | null {
    const keyringEntry = this.getKeyringEntry(field);

    if (keyringEntry) {
      try {
        const value = keyringEntry.getPassword();
        if (value !== null) return value;
      } catch {
        // Fall through to the encrypted Db store.
      }
    }

    try {
      const value = this.getDb().get(field);

      // Backfill older Db-only tokens into the keychain when possible.
      if (value !== null && keyringEntry) {
        try {
          keyringEntry.setPassword(value);
        } catch {
          // Ignore migration failures and keep the Db value.
        }
      }

      return value;
    } catch {
      return null;
    }
  }

  set(field: string, value: unknown): void {
    const normalized = `${value}`;
    const keyringEntry = this.getKeyringEntry(field);

    if (keyringEntry) {
      try {
        keyringEntry.setPassword(normalized);
        return;
      } catch {
        // Fall through to the encrypted Db store.
      }
    }

    this.getDb().set(field, normalized);
  }

  delete(field: string): void {
    const keyringEntry = this.getKeyringEntry(field);

    if (keyringEntry) {
      try {
        keyringEntry.deletePassword();
      } catch {
        // Ignore — may not exist in keyring
      }
    }

    try {
      this.getDb().delete(field);
    } catch {
      // Ignore — may not exist in Db
    }
  }
}
