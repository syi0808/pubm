import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  computeSha256FromUrl,
  generateFormula,
  mapReleaseAssets,
  updateFormula,
} from "../../src/formula.js";

describe("formula helpers", () => {
  it("generates a formula with class name conversion and placeholders", () => {
    const content = generateFormula({
      name: "my_tool-cli",
      desc: "Example CLI",
      homepage: "https://example.com",
      license: "Apache-2.0",
      version: "1.2.3",
      assets: [
        {
          platform: "darwin-arm64",
          url: "https://example.com/darwin-arm64.tar.gz",
          sha256: "arm64-sha",
        },
        {
          platform: "linux-x64",
          url: "https://example.com/linux-x64.tar.gz",
          sha256: "linux-x64-sha",
        },
      ],
    });

    expect(content).toContain("class MyToolCli < Formula");
    expect(content).toContain('desc "Example CLI"');
    expect(content).toContain('version "1.2.3"');
    expect(content).toContain('url "https://example.com/darwin-arm64.tar.gz"');
    expect(content).toContain('sha256 "arm64-sha"');
    expect(content).toContain('url "PLACEHOLDER"');
    expect(content).toContain('bin.install "my_tool-cli"');
  });

  it("updates version and platform-specific url/sha256 pairs", () => {
    const original = generateFormula({
      name: "pubm",
      desc: "pubm cli",
      homepage: "https://example.com/pubm",
      license: "MIT",
      version: "0.1.0",
      assets: [
        {
          platform: "darwin-arm64",
          url: "https://example.com/old-darwin-arm64.tar.gz",
          sha256: "old-darwin-arm64",
        },
        {
          platform: "darwin-x64",
          url: "https://example.com/old-darwin-x64.tar.gz",
          sha256: "old-darwin-x64",
        },
        {
          platform: "linux-arm64",
          url: "https://example.com/old-linux-arm64.tar.gz",
          sha256: "old-linux-arm64",
        },
        {
          platform: "linux-x64",
          url: "https://example.com/old-linux-x64.tar.gz",
          sha256: "old-linux-x64",
        },
      ],
    });

    const updated = updateFormula(original, "2.0.0", [
      {
        platform: "darwin-arm64",
        url: "https://example.com/new-darwin-arm64.tar.gz",
        sha256: "new-darwin-arm64",
      },
      {
        platform: "linux-x64",
        url: "https://example.com/new-linux-x64.tar.gz",
        sha256: "new-linux-x64",
      },
    ]);

    expect(updated).toContain('version "2.0.0"');
    expect(updated).toContain(
      'url "https://example.com/new-darwin-arm64.tar.gz"',
    );
    expect(updated).toContain('sha256 "new-darwin-arm64"');
    expect(updated).toContain('url "https://example.com/new-linux-x64.tar.gz"');
    expect(updated).toContain('sha256 "new-linux-x64"');
    expect(updated).toContain(
      'url "https://example.com/old-darwin-x64.tar.gz"',
    );
    expect(updated).toContain(
      'url "https://example.com/old-linux-arm64.tar.gz"',
    );
  });

  it("maps only recognized release assets", () => {
    const mapped = mapReleaseAssets([
      {
        name: "pubm-darwin-arm64.tar.gz",
        url: "https://example.com/darwin-arm64.tar.gz",
        sha256: "a",
      },
      {
        name: "pubm-linux-x64.zip",
        url: "https://example.com/linux-x64.zip",
        sha256: "b",
      },
      {
        name: "pubm-windows-x64.zip",
        url: "https://example.com/windows-x64.zip",
        sha256: "c",
      },
    ]);

    expect(mapped).toEqual([
      {
        platform: "darwin-arm64",
        url: "https://example.com/darwin-arm64.tar.gz",
        sha256: "a",
      },
      {
        platform: "linux-x64",
        url: "https://example.com/linux-x64.zip",
        sha256: "b",
      },
    ]);
  });

  it("computes sha256 from a fetched asset", async () => {
    const body = new TextEncoder().encode("pubm-release");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(body, { status: 200 }),
    );

    const sha = await computeSha256FromUrl("https://example.com/pubm.tgz");

    expect(sha).toBe(
      createHash("sha256").update(Buffer.from(body)).digest("hex"),
    );
  });

  it("throws when fetching the asset fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("missing", { status: 404, statusText: "Not Found" }),
    );

    await expect(
      computeSha256FromUrl("https://example.com/missing.tgz"),
    ).rejects.toThrow(
      "Failed to fetch https://example.com/missing.tgz: Not Found",
    );
  });
});
