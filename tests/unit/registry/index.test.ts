import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/registry/npm.js", () => ({
  npmRegistry: vi.fn(),
}));

vi.mock("../../../src/registry/jsr.js", () => ({
  jsrRegistry: vi.fn(),
}));

vi.mock("../../../src/registry/custom-registry.js", () => ({
  customRegistry: vi.fn(),
}));

import { customRegistry } from "../../../src/registry/custom-registry.js";
import { getRegistry } from "../../../src/registry/index.js";
import { jsrRegistry } from "../../../src/registry/jsr.js";
import { npmRegistry } from "../../../src/registry/npm.js";

const mockedNpmRegistry = vi.mocked(npmRegistry);
const mockedJsrRegistry = vi.mocked(jsrRegistry);
const mockedCustomRegistry = vi.mocked(customRegistry);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getRegistry()", () => {
  it('returns npm registry for "npm" key', async () => {
    const fakeNpm = { packageName: "test" };
    mockedNpmRegistry.mockResolvedValue(fakeNpm as any);

    const result = await getRegistry("npm");

    expect(mockedNpmRegistry).toHaveBeenCalled();
    expect(result).toBe(fakeNpm);
  });

  it('returns jsr registry for "jsr" key', async () => {
    const fakeJsr = { packageName: "test" };
    mockedJsrRegistry.mockResolvedValue(fakeJsr as any);

    const result = await getRegistry("jsr");

    expect(mockedJsrRegistry).toHaveBeenCalled();
    expect(result).toBe(fakeJsr);
  });

  it("returns custom registry for unknown key", async () => {
    const fakeCustom = { packageName: "test" };
    mockedCustomRegistry.mockResolvedValue(fakeCustom as any);

    const result = await getRegistry("https://npm.example.com");

    expect(mockedCustomRegistry).toHaveBeenCalled();
    expect(result).toBe(fakeCustom);
  });

  it("does not call npmRegistry or jsrRegistry for unknown key", async () => {
    mockedCustomRegistry.mockResolvedValue({} as any);

    await getRegistry("https://custom.registry.io");

    expect(mockedNpmRegistry).not.toHaveBeenCalled();
    expect(mockedJsrRegistry).not.toHaveBeenCalled();
  });

  it('does not call customRegistry for "npm" key', async () => {
    mockedNpmRegistry.mockResolvedValue({} as any);

    await getRegistry("npm");

    expect(mockedCustomRegistry).not.toHaveBeenCalled();
  });

  it('does not call customRegistry for "jsr" key', async () => {
    mockedJsrRegistry.mockResolvedValue({} as any);

    await getRegistry("jsr");

    expect(mockedCustomRegistry).not.toHaveBeenCalled();
  });
});
