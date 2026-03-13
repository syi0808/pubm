import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/registry/custom-registry.js", () => ({
  customRegistry: vi.fn(),
}));

vi.mock("../../../src/registry/catalog.js", () => {
  const mockCatalog = {
    get: vi.fn(),
    all: vi.fn().mockReturnValue([]),
    getByEcosystem: vi.fn().mockReturnValue([]),
    register: vi.fn(),
  };
  return {
    registryCatalog: mockCatalog,
    RegistryCatalog: vi.fn(),
  };
});

import { registryCatalog } from "../../../src/registry/catalog.js";
import { customRegistry } from "../../../src/registry/custom-registry.js";
import { getRegistry } from "../../../src/registry/index.js";

const mockedCustomRegistry = vi.mocked(customRegistry);
const mockedCatalogGet = vi.mocked(registryCatalog.get);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getRegistry()", () => {
  it("returns registry from catalog factory for known key", async () => {
    const fakeRegistry = { packageName: "test" };
    const fakeDescriptor = {
      factory: vi.fn().mockResolvedValue(fakeRegistry),
    };
    mockedCatalogGet.mockReturnValue(fakeDescriptor as any);

    const result = await getRegistry("npm");

    expect(mockedCatalogGet).toHaveBeenCalledWith("npm");
    expect(fakeDescriptor.factory).toHaveBeenCalledWith(undefined);
    expect(result).toBe(fakeRegistry);
  });

  it("passes packageName to factory", async () => {
    const fakeDescriptor = {
      factory: vi.fn().mockResolvedValue({}),
    };
    mockedCatalogGet.mockReturnValue(fakeDescriptor as any);

    await getRegistry("crates", "my-crate");

    expect(fakeDescriptor.factory).toHaveBeenCalledWith("my-crate");
  });

  it("returns custom registry for unknown key", async () => {
    mockedCatalogGet.mockReturnValue(undefined);
    const fakeCustom = { packageName: "custom" };
    mockedCustomRegistry.mockResolvedValue(fakeCustom as any);

    const result = await getRegistry("https://custom.registry.io");

    expect(mockedCustomRegistry).toHaveBeenCalled();
    expect(result).toBe(fakeCustom);
  });

  it("does not call customRegistry for known key", async () => {
    mockedCatalogGet.mockReturnValue({
      factory: vi.fn().mockResolvedValue({}),
    } as any);

    await getRegistry("npm");

    expect(mockedCustomRegistry).not.toHaveBeenCalled();
  });
});
