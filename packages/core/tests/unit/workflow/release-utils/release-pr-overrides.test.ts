import { describe, expect, it } from "vitest";
import type { PubmContext, VersionPlan } from "../../../../src/context.js";
import {
  applyReleaseOverride,
  parseReleasePrLabelOverride,
  parseReleasePrSlashCommand,
  parseReleasePrSlashCommands,
  resolveReleasePrOverride,
} from "../../../../src/workflow/release-utils/release-pr-overrides.js";
import type { ReleasePrScope } from "../../../../src/workflow/release-utils/scope.js";

function ctx(): PubmContext {
  return {
    config: {
      packages: [
        {
          ecosystem: "js",
          name: "pkg-a",
          path: "packages/a",
          registries: ["npm"],
          version: "1.2.3",
        },
        {
          ecosystem: "js",
          name: "pkg-b",
          path: "packages/b",
          registries: ["npm"],
          version: "1.2.3",
        },
      ],
    },
  } as PubmContext;
}

describe("release PR overrides", () => {
  it("parses labels and picks the highest configured bump", () => {
    expect(
      parseReleasePrLabelOverride(["release:patch", "release:major"]),
    ).toEqual({ source: "label", kind: "bump", bump: "major" });
    expect(parseReleasePrLabelOverride(["no-release"])).toBeUndefined();
    expect(
      parseReleasePrLabelOverride(["custom-minor"], {
        minor: "custom-minor",
      }),
    ).toEqual({ source: "label", kind: "bump", bump: "minor" });
  });

  it("parses slash commands", () => {
    expect(parseReleasePrSlashCommand("/pubm bump minor")).toEqual({
      source: "slash",
      kind: "bump",
      bump: "minor",
    });
    expect(parseReleasePrSlashCommand("/pubm release-as 2.0.0-beta.1")).toEqual(
      {
        source: "slash",
        kind: "release-as",
        version: "2.0.0-beta.1",
      },
    );
    expect(() => parseReleasePrSlashCommand("/pubm release-as no")).toThrow(
      "Invalid release-as version",
    );
    expect(() => parseReleasePrSlashCommand("/pubm bump huge")).toThrow(
      'Unsupported bump override "huge"',
    );
    expect(() => parseReleasePrSlashCommand("/pubm unknown")).toThrow(
      'Unsupported pubm command "/pubm unknown"',
    );
  });

  it("extracts slash commands, reports invalid commands, and sorts by time", () => {
    const result = parseReleasePrSlashCommands([
      {
        body: ["note", "/pubm bump patch", "/pubm bump huge"].join("\n"),
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      },
      { body: "/pubm bump minor", createdAt: 1_800_000_000_000 },
    ]);

    expect(result.override).toEqual({
      source: "slash",
      kind: "bump",
      bump: "minor",
    });
    expect(result.errors).toEqual([
      {
        command: "/pubm bump huge",
        message: 'Unsupported bump override "huge"',
      },
    ]);
  });

  it("prefers the newest valid slash command over labels", () => {
    const result = resolveReleasePrOverride({
      labels: ["release:major"],
      comments: [
        { body: "/pubm bump patch", createdAt: "2026-01-01T00:00:00.000Z" },
        { body: "/pubm bump minor", createdAt: "2026-01-02T00:00:00.000Z" },
      ],
    });

    expect(result.override).toEqual({
      source: "slash",
      kind: "bump",
      bump: "minor",
    });
    expect(result.errors).toEqual([]);
    expect(resolveReleasePrOverride({ labels: [] })).toEqual({ errors: [] });
    expect(
      resolveReleasePrOverride({
        labels: ["release:patch"],
        comments: [{ body: "plain comment", createdAt: undefined }],
      }).override,
    ).toEqual({ source: "label", kind: "bump", bump: "patch" });
  });

  it("applies bump overrides only to package keys in scope", () => {
    const plan: VersionPlan = {
      mode: "independent",
      packages: new Map([
        ["packages/a::js", "1.2.4"],
        ["packages/b::js", "1.2.4"],
      ]),
    };
    const scope: ReleasePrScope = {
      id: "packages/a::js",
      kind: "package",
      packageKeys: ["packages/a::js"],
      displayName: "pkg-a",
      slug: "pkg-a",
    };

    const next = applyReleaseOverride(ctx(), plan, scope, {
      source: "slash",
      kind: "bump",
      bump: "minor",
    });

    expect(next.mode).toBe("independent");
    expect(next.mode === "independent" && [...next.packages]).toEqual([
      ["packages/a::js", "1.3.0"],
      ["packages/b::js", "1.2.4"],
    ]);
  });

  it("rejects explicit multi-package release-as for arbitrary scopes", () => {
    const plan: VersionPlan = {
      mode: "independent",
      packages: new Map([
        ["packages/a::js", "1.2.4"],
        ["packages/b::js", "1.2.4"],
      ]),
    };
    const scope: ReleasePrScope = {
      id: "single",
      kind: "single",
      packageKeys: ["packages/a::js", "packages/b::js"],
      displayName: "release",
      slug: "release",
    };

    expect(() =>
      applyReleaseOverride(ctx(), plan, scope, {
        source: "slash",
        kind: "release-as",
        version: "2.0.0",
      }),
    ).toThrow("release-as can target multiple packages");
  });

  it("applies release-as overrides to single and fixed scopes", () => {
    const singlePlan: VersionPlan = {
      mode: "single",
      packageKey: "packages/a::js",
      version: "1.2.3",
    };
    const packageScope: ReleasePrScope = {
      id: "packages/a::js",
      kind: "package",
      packageKeys: ["packages/a::js"],
      displayName: "pkg-a",
      slug: "pkg-a",
    };

    expect(
      applyReleaseOverride(ctx(), singlePlan, packageScope, {
        source: "slash",
        kind: "release-as",
        version: "2.0.0",
      }),
    ).toEqual({
      mode: "single",
      packageKey: "packages/a::js",
      version: "2.0.0",
    });

    const fixedPlan: VersionPlan = {
      mode: "fixed",
      version: "1.2.4",
      packages: new Map([
        ["packages/a::js", "1.2.4"],
        ["packages/b::js", "1.2.4"],
      ]),
    };
    const fixedScope: ReleasePrScope = {
      id: "fixed",
      kind: "fixed",
      packageKeys: ["packages/a::js", "packages/b::js"],
      displayName: "release",
      slug: "release",
    };

    expect(
      applyReleaseOverride(ctx(), fixedPlan, fixedScope, {
        source: "slash",
        kind: "release-as",
        version: "2.0.0",
      }),
    ).toEqual({
      mode: "fixed",
      version: "2.0.0",
      packages: new Map([
        ["packages/a::js", "2.0.0"],
        ["packages/b::js", "2.0.0"],
      ]),
    });
  });

  it("leaves out-of-scope single plans unchanged and rejects unknown bump targets", () => {
    const singlePlan: VersionPlan = {
      mode: "single",
      packageKey: "packages/a::js",
      version: "1.2.3",
    };
    const otherScope: ReleasePrScope = {
      id: "packages/b::js",
      kind: "package",
      packageKeys: ["packages/b::js"],
      displayName: "pkg-b",
      slug: "pkg-b",
    };

    expect(
      applyReleaseOverride(ctx(), singlePlan, otherScope, {
        source: "slash",
        kind: "bump",
        bump: "minor",
      }),
    ).toEqual(singlePlan);

    expect(() =>
      applyReleaseOverride(
        ctx(),
        {
          mode: "independent",
          packages: new Map([["missing::js", "1.2.3"]]),
        },
        {
          ...otherScope,
          packageKeys: ["missing::js"],
        },
        {
          source: "slash",
          kind: "bump",
          bump: "minor",
        },
      ),
    ).toThrow('Unknown package key "missing::js"');
  });
});
