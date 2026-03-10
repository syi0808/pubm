import { Db } from "./db.js";

export class SecureStore {
  private db: Db | null = null;

  private getDb(): Db {
    if (!this.db) this.db = new Db();
    return this.db;
  }

  get(field: string): string | null {
    try {
      return this.getDb().get(field);
    } catch {
      return null;
    }
  }

  set(field: string, value: unknown): void {
    this.getDb().set(field, value);
  }
}
