import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", () => ({
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

import { mkdirSync, writeFileSync } from "node:fs";
import {
  generateChangesetContent,
  generateChangesetId,
  writeChangeset,
} from "../../../src/changeset/writer.js";

const mockedMkdirSync = vi.mocked(mkdirSync);
const mockedWriteFileSync = vi.mocked(writeFileSync);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("generateChangesetContent", () => {
  it("generates content with a single release", () => {
    const content = generateChangesetContent(
      [{ path: "pkg-a", type: "minor" }],
      "Added a feature.",
    );

    expect(content).toContain("---\n");
    expect(content).toContain("pkg-a: minor");
    expect(content).toContain("Added a feature.");
  });

  it("generates content with multiple releases", () => {
    const content = generateChangesetContent(
      [
        { path: "pkg-a", type: "major" },
        { path: "@scope/pkg-b", type: "patch" },
      ],
      "Breaking change.",
    );

    expect(content).toContain("pkg-a: major");
    expect(content).toContain('"@scope/pkg-b": patch');
    expect(content).toContain("Breaking change.");
  });

  it("generates content for empty changeset", () => {
    const content = generateChangesetContent([], "Just a note.");

    expect(content).toBe("---\n---\n\nJust a note.\n");
  });

  it("generates content without summary when summary is empty", () => {
    const content = generateChangesetContent(
      [{ path: "pkg-a", type: "patch" }],
      "",
    );

    expect(content).toContain("pkg-a: patch");
    expect(content.endsWith("---\n")).toBe(true);
  });
});

describe("generateChangesetId", () => {
  it("returns adjective-noun format", () => {
    const id = generateChangesetId();

    expect(id).toMatch(/^[a-z]+-[a-z]+-[a-z0-9]+$/);
  });

  it("generates unique ids across multiple calls", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 50; i++) {
      ids.add(generateChangesetId());
    }

    expect(ids.size).toBeGreaterThan(1);
  });
});

describe("writeChangeset", () => {
  it("creates directory if missing", () => {
    writeChangeset([{ path: "pkg", type: "patch" }], "Fix.", "/tmp/project");

    expect(mockedMkdirSync).toHaveBeenCalledWith(
      expect.stringContaining(path.join(".pubm", "changesets")),
      { recursive: true },
    );
  });

  it("writes file with correct content", () => {
    writeChangeset(
      [{ path: "pkg", type: "minor" }],
      "New feature.",
      "/tmp/project",
    );

    expect(mockedWriteFileSync).toHaveBeenCalledWith(
      expect.stringMatching(
        new RegExp(
          `\\.pubm\\${path.sep}changesets\\${path.sep}[a-z]+-[a-z]+-[a-z0-9]+\\.md$`,
        ),
      ),
      expect.stringContaining("pkg: minor"),
      "utf-8",
    );
  });

  it("uses process.cwd() as default when cwd is omitted", () => {
    writeChangeset([{ path: "pkg", type: "patch" }], "Fix.");

    expect(mockedMkdirSync).toHaveBeenCalledWith(
      expect.stringContaining(path.join(process.cwd(), ".pubm", "changesets")),
      { recursive: true },
    );
  });

  it("returns the file path", () => {
    const filePath = writeChangeset(
      [{ path: "pkg", type: "patch" }],
      "Fix bug.",
      "/tmp/project",
    );

    const sep = path.sep.replace(/\\/, "\\\\");
    expect(filePath).toMatch(
      new RegExp(
        `${sep}tmp${sep}project${sep}\\.pubm${sep}changesets${sep}[a-z]+-[a-z]+-[a-z0-9]+\\.md$`,
      ),
    );
  });
});
