import { Entry } from "@napi-rs/keyring";
import { Db } from "./db.js";

const SERVICE = "pubm";

export class SecureStore {
  private db: Db | null = null;

  private getDb(): Db {
    if (!this.db) this.db = new Db();
    return this.db;
  }

  get(field: string): string | null {
    try {
      const entry = new Entry(SERVICE, field);
      const value = entry.getPassword();
      if (value) return value;
    } catch {}

    try {
      return this.getDb().get(field);
    } catch {}

    return null;
  }

  set(field: string, value: unknown): void {
    try {
      const entry = new Entry(SERVICE, field);
      entry.setPassword(`${value}`);
      return;
    } catch {}

    this.getDb().set(field, value);
  }
}
