import { describe, expect, it } from "vitest";
import {
  invalidBody,
  MARKER,
  missingBody,
  skippedBody,
  successBody,
} from "../src/templates.js";

describe("templates", () => {
  it("all templates include the bot marker", () => {
    const changesets = [
      {
        id: "brave-fox",
        summary: "Add feature",
        releases: [{ path: "packages/core", type: "minor" as const }],
      },
    ];

    expect(successBody(changesets)).toContain(MARKER);
    expect(missingBody("no-changeset")).toContain(MARKER);
    expect(invalidBody([{ file: "test.md", message: "error" }])).toContain(
      MARKER,
    );
    expect(skippedBody("no-changeset")).toContain(MARKER);
  });

  it("successBody renders file table", () => {
    const body = successBody([
      {
        id: "brave-fox",
        summary: "Add feature",
        releases: [{ path: "packages/core", type: "minor" as const }],
      },
    ]);

    expect(body).toContain("Changeset detected");
    expect(body).toContain("`brave-fox.md`");
    expect(body).toContain("`packages/core`");
    expect(body).toContain("minor");
  });

  it("missingBody includes usage instructions", () => {
    const body = missingBody("no-changeset");

    expect(body).toContain("No changeset found");
    expect(body).toContain("pubm changesets add");
    expect(body).toContain("`no-changeset`");
  });

  it("invalidBody renders error table", () => {
    const body = invalidBody([
      { file: "bad.md", message: 'Invalid bump type "big"' },
    ]);

    expect(body).toContain("Invalid changeset");
    expect(body).toContain("`bad.md`");
    expect(body).toContain('Invalid bump type "big"');
  });

  it("skippedBody includes the label name", () => {
    const body = skippedBody("skip-check");

    expect(body).toContain("Changeset check skipped");
    expect(body).toContain("`skip-check`");
  });
});
