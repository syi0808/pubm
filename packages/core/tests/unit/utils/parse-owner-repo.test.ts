import { describe, expect, it } from "vitest";
import { parseOwnerRepo } from "../../../src/utils/parse-owner-repo.js";

describe("parseOwnerRepo", () => {
  it("parses SSH remote URL", () => {
    expect(parseOwnerRepo("git@github.com:owner/repo.git")).toEqual({
      owner: "owner",
      repo: "repo",
    });
  });

  it("parses SSH remote URL without .git suffix", () => {
    expect(parseOwnerRepo("git@github.com:owner/repo")).toEqual({
      owner: "owner",
      repo: "repo",
    });
  });

  it("parses HTTPS remote URL", () => {
    expect(parseOwnerRepo("https://github.com/owner/repo.git")).toEqual({
      owner: "owner",
      repo: "repo",
    });
  });

  it("parses HTTPS remote URL without .git suffix", () => {
    expect(parseOwnerRepo("https://github.com/owner/repo")).toEqual({
      owner: "owner",
      repo: "repo",
    });
  });

  it("throws on unparseable URL", () => {
    expect(() => parseOwnerRepo("not-a-url")).toThrow(
      "Cannot parse owner/repo from remote URL: not-a-url",
    );
  });
});
