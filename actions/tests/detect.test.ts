import * as child_process from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { detectChangesetFiles } from "../src/detect.js";

vi.mock("node:child_process");

describe("detectChangesetFiles", () => {
  it("returns changeset files from git diff", () => {
    vi.mocked(child_process.execFileSync).mockReturnValue(
      ".pubm/changesets/brave-fox.md\n.pubm/changesets/calm-owl.md\n",
    );

    const result = detectChangesetFiles("main", "/project");
    expect(result).toEqual([
      ".pubm/changesets/brave-fox.md",
      ".pubm/changesets/calm-owl.md",
    ]);
  });

  it("filters out README.md", () => {
    vi.mocked(child_process.execFileSync).mockReturnValue(
      ".pubm/changesets/brave-fox.md\n.pubm/changesets/README.md\n",
    );

    const result = detectChangesetFiles("main", "/project");
    expect(result).toEqual([".pubm/changesets/brave-fox.md"]);
  });

  it("returns empty array when no changesets found", () => {
    vi.mocked(child_process.execFileSync).mockReturnValue("");

    const result = detectChangesetFiles("main", "/project");
    expect(result).toEqual([]);
  });

  it("returns empty array on git command failure", () => {
    vi.mocked(child_process.execFileSync).mockImplementation(() => {
      throw new Error("git failed");
    });

    const result = detectChangesetFiles("main", "/project");
    expect(result).toEqual([]);
  });

  it("uses the configured changeset directory", () => {
    vi.mocked(child_process.execFileSync).mockReturnValue(
      ".changesets/brave-fox.md\n",
    );

    const result = detectChangesetFiles("main", "/project", ".changesets/");

    expect(result).toEqual([".changesets/brave-fox.md"]);
    expect(child_process.execFileSync).toHaveBeenCalledWith(
      "git",
      [
        "diff",
        "--name-only",
        "--diff-filter=ACMR",
        "origin/main...HEAD",
        "--",
        ".changesets/*.md",
      ],
      { cwd: "/project", encoding: "utf8" },
    );
  });
});
