import { beforeEach, describe, expect, it, vi } from "vitest";

async function importFreshMetadata() {
  vi.resetModules();
  return await import("../../../src/utils/pubm-metadata.js");
}

describe("pubm metadata", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("falls back to default engines when package.json has no engines field", async () => {
    vi.doMock("../../../package.json", () => ({
      default: { name: "@pubm/core", version: "0.0.0-test" },
    }));

    const metadata = await importFreshMetadata();

    // Without engines in package.json, the ?? fallbacks are used
    expect(metadata.PUBM_ENGINES.node).toBe(">=18");
    expect(metadata.PUBM_ENGINES.git).toBe(">=2.11.0");
    expect(metadata.PUBM_ENGINES.npm).toBe("*");
    expect(metadata.PUBM_ENGINES.pnpm).toBe("*");
    expect(metadata.PUBM_ENGINES.yarn).toBe("*");
  });

  it("falls back to CLI package metadata when defines are absent", async () => {
    const metadata = await importFreshMetadata();

    expect(metadata.PUBM_VERSION).toBeTruthy();
    expect(metadata.PUBM_ENGINES.node).toMatch(/^>=/);
    expect(metadata.PUBM_ENGINES.git).toMatch(/^>=/);
    expect(metadata.PUBM_ENGINES.npm).toBe("*");
    expect(metadata.PUBM_ENGINES.pnpm).toBe("*");
    expect(metadata.PUBM_ENGINES.yarn).toBe("*");
  });

  it("prefers injected define values over package metadata", async () => {
    vi.stubGlobal("__PUBM_VERSION__", "9.9.9");
    vi.stubGlobal("__PUBM_NODE_ENGINE__", ">=30");
    vi.stubGlobal("__PUBM_GIT_ENGINE__", ">=99");
    vi.stubGlobal("__PUBM_NPM_ENGINE__", ">=11");
    vi.stubGlobal("__PUBM_PNPM_ENGINE__", ">=10");
    vi.stubGlobal("__PUBM_YARN_ENGINE__", ">=4");

    const metadata = await importFreshMetadata();

    expect(metadata.PUBM_VERSION).toBe("9.9.9");
    expect(metadata.PUBM_ENGINES).toEqual({
      node: ">=30",
      git: ">=99",
      npm: ">=11",
      pnpm: ">=10",
      yarn: ">=4",
    });
  });
});
