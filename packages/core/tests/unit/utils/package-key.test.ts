import { describe, expect, it } from "vitest";
import { packageKey } from "../../../src/utils/package-key.js";

describe("packageKey", () => {
  it("creates composite key from path and ecosystem", () => {
    expect(packageKey({ path: "packages/core", ecosystem: "js" })).toBe(
      "packages/core::js",
    );
  });

  it("produces different keys for same path with different ecosystem", () => {
    const jsKey = packageKey({ path: ".", ecosystem: "js" });
    const rustKey = packageKey({ path: ".", ecosystem: "rust" });
    expect(jsKey).not.toBe(rustKey);
  });

  it("produces different keys for different paths with same ecosystem", () => {
    const a = packageKey({ path: "packages/a", ecosystem: "js" });
    const b = packageKey({ path: "packages/b", ecosystem: "js" });
    expect(a).not.toBe(b);
  });
});
