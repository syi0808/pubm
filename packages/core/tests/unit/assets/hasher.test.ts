import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { computeSha256 } from "../../../src/assets/hasher.js";

describe("computeSha256", () => {
  it("computes correct sha256 for known content", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hasher-test-"));
    const file = join(dir, "test.txt");
    writeFileSync(file, "hello world");
    const hash = await computeSha256(file);
    expect(hash).toBe(
      "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9",
    );
  });

  it("computes different hash for different content", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hasher-test-"));
    const f1 = join(dir, "a.txt");
    const f2 = join(dir, "b.txt");
    writeFileSync(f1, "aaa");
    writeFileSync(f2, "bbb");
    const h1 = await computeSha256(f1);
    const h2 = await computeSha256(f2);
    expect(h1).not.toBe(h2);
  });
});
