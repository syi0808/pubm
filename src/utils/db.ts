import { createCipheriv, createDecipheriv, createHash } from "node:crypto";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const a = "aes-256-cbc";
const h = homedir();
const n = statSync(h);
const k = `${n.rdev}${n.birthtimeMs}${n.nlink}${n.gid}`;
const l = createHash("md5").update(k).digest();

function e(e: string, f: string): string {
  const c = createCipheriv(a, createHash("sha-256").update(f).digest(), l);
  return c.update(e, "utf8", "hex") + c.final("hex");
}

function d(g: string, h: string): string {
  const d = createDecipheriv(a, createHash("sha-256").update(h).digest(), l);
  return d.update(g, "hex", "utf8") + d.final("utf8");
}

export class Db {
  path = path.resolve(h, ".pubm");

  constructor() {
    try {
      if (!statSync(this.path).isDirectory()) {
        mkdirSync(this.path);
      }
    } catch {
      try {
        mkdirSync(this.path);
      } catch (error) {
        throw new Error(
          `Failed to create token storage directory at '${this.path}': ${error instanceof Error ? error.message : error}`,
        );
      }
    }
  }

  set(field: string, value: unknown): void {
    try {
      writeFileSync(
        path.resolve(
          this.path,
          Buffer.from(e(field, field)).toString("base64"),
        ),
        Buffer.from(e(`${value}`, field)),
        { encoding: "binary" },
      );
    } catch (error) {
      throw new Error(
        `Failed to save token for '${field}': ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  get(field: string): string | null {
    const filePath = path.resolve(
      this.path,
      Buffer.from(e(field, field)).toString("base64"),
    );

    let raw: Buffer;
    try {
      raw = readFileSync(filePath);
    } catch {
      return null;
    }

    try {
      return d(Buffer.from(raw).toString(), field);
    } catch {
      console.warn(
        `Stored token for '${field}' appears corrupted. It will be re-requested.`,
      );
      return null;
    }
  }
}
