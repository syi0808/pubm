import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createKeyResolver } from "../../../../src/changeset/resolve.js";
import { consumeChangesetsForScope } from "../../../../src/workflow/release-utils/changeset-consume.js";

let root = "";
let changesetsDir = "";

const packages = [
  {
    ecosystem: "js" as const,
    name: "pkg-a",
    path: "packages/a",
  },
  {
    ecosystem: "rust" as const,
    name: "crate-a",
    path: "crates/a",
  },
];

beforeEach(() => {
  root = path.join(tmpdir(), `pubm-consume-${Date.now()}`);
  changesetsDir = path.join(root, ".pubm", "changesets");
  mkdirSync(changesetsDir, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("consumeChangesetsForScope", () => {
  it("deletes files when every release entry is consumed", () => {
    const file = path.join(changesetsDir, "full.md");
    writeFileSync(file, "---\npackages/a::js: patch\n---\n\nFull summary\n");

    const result = consumeChangesetsForScope({
      cwd: root,
      packageKeys: new Set(["packages/a::js"]),
      resolver: createKeyResolver(packages),
    });

    expect(result.consumed).toEqual([
      {
        id: "full",
        summary: "Full summary",
        releases: [{ path: "packages/a", ecosystem: "js", type: "patch" }],
      },
    ]);
    expect(result.deletedFiles).toEqual([file.replace(/\\/g, "/")]);
  });

  it("rewrites files with remaining releases and preserves summaries", () => {
    const file = path.join(changesetsDir, "partial.md");
    writeFileSync(
      file,
      "---\npackages/a::js: minor\ncrates/a::rust: patch\n---\n\nKeep this summary\n",
    );

    const result = consumeChangesetsForScope({
      cwd: root,
      packageKeys: new Set(["packages/a::js"]),
      resolver: createKeyResolver(packages),
    });

    expect(result.rewrittenFiles).toEqual([file.replace(/\\/g, "/")]);
    expect(result.deletedFiles).toEqual([]);
    expect(result.consumed[0].releases).toEqual([
      { path: "packages/a", ecosystem: "js", type: "minor" },
    ]);
    expect(readFileSync(file, "utf-8")).toBe(
      "---\ncrates/a::rust: patch\n---\n\nKeep this summary\n",
    );
  });

  it("leaves unrelated files unchanged", () => {
    const file = path.join(changesetsDir, "noop.md");
    const content = "---\ncrates/a::rust: patch\n---\n\nNoop\n";
    writeFileSync(file, content);

    const result = consumeChangesetsForScope({
      cwd: root,
      packageKeys: new Set(["packages/a::js"]),
      resolver: createKeyResolver(packages),
    });

    expect(result).toEqual({
      consumed: [],
      rewrittenFiles: [],
      deletedFiles: [],
    });
    expect(readFileSync(file, "utf-8")).toBe(content);
  });

  it("uses the resolver for package-name changeset keys", () => {
    const file = path.join(changesetsDir, "name-key.md");
    writeFileSync(file, "---\npkg-a: patch\n---\n\nBy name\n");

    const result = consumeChangesetsForScope({
      cwd: root,
      packageKeys: new Set(["packages/a::js"]),
      resolver: createKeyResolver(packages),
    });

    expect(result.consumed[0].releases).toEqual([
      { path: "packages/a", ecosystem: "js", type: "patch" },
    ]);
    expect(result.deletedFiles).toEqual([file.replace(/\\/g, "/")]);
  });
});
