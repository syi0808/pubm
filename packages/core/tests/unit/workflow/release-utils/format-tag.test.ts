import { describe, expect, it } from "vitest";
import type { PubmContext } from "../../../../src/context.js";
import { formatTag } from "../../../../src/workflow/release-utils/rollback-handlers.js";

function createMockContext(
  overrides: {
    registryQualifiedTags?: boolean;
    runtimeRegistryQualifiedTags?: boolean;
    packages?: Array<{
      name: string;
      path: string;
      ecosystem: string;
      registries: string[];
    }>;
  } = {},
): PubmContext {
  const packages = overrides.packages ?? [
    {
      name: "my-pkg",
      path: "packages/my-pkg",
      ecosystem: "js",
      registries: ["npm"],
      version: "1.0.0",
      dependencies: [],
    },
  ];
  return {
    config: {
      registryQualifiedTags: overrides.registryQualifiedTags ?? false,
      packages,
    },
    runtime: {
      registryQualifiedTags: overrides.runtimeRegistryQualifiedTags,
    },
  } as unknown as PubmContext;
}

describe("formatTag", () => {
  it("returns standard tag when registryQualifiedTags is false", () => {
    const ctx = createMockContext();
    const tag = formatTag(ctx, "packages/my-pkg::js", "1.0.0");
    expect(tag).toBe("my-pkg@1.0.0");
  });

  it("returns registry-qualified tag when config registryQualifiedTags is true", () => {
    const ctx = createMockContext({ registryQualifiedTags: true });
    const tag = formatTag(ctx, "packages/my-pkg::js", "1.0.0");
    expect(tag).toBe("npm/my-pkg@1.0.0");
  });

  it("returns registry-qualified tag when runtime registryQualifiedTags is true", () => {
    const ctx = createMockContext({ runtimeRegistryQualifiedTags: true });
    const tag = formatTag(ctx, "packages/my-pkg::js", "1.0.0");
    expect(tag).toBe("npm/my-pkg@1.0.0");
  });

  it("uses the first registry from the package config", () => {
    const ctx = createMockContext({
      registryQualifiedTags: true,
      packages: [
        {
          name: "multi-reg",
          path: "packages/multi",
          ecosystem: "js",
          registries: ["jsr", "npm"],
        },
      ],
    });
    const tag = formatTag(ctx, "packages/multi::js", "2.0.0");
    expect(tag).toBe("jsr/multi-reg@2.0.0");
  });

  it("throws when registryQualifiedTags is true but package has no registries", () => {
    const ctx = createMockContext({
      registryQualifiedTags: true,
      packages: [
        {
          name: "no-reg",
          path: "packages/no-reg",
          ecosystem: "js",
          registries: [],
        },
      ],
    });
    expect(() => formatTag(ctx, "packages/no-reg::js", "1.0.0")).toThrow(
      /no registries defined/,
    );
  });

  it("falls back to path when package name is not found", () => {
    const ctx = createMockContext();
    const tag = formatTag(ctx, "packages/unknown::js", "1.0.0");
    expect(tag).toBe("packages/unknown@1.0.0");
  });
});
