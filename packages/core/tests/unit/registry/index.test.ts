import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/registry/custom-registry.js", () => ({
  customPackageRegistry: vi.fn(),
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
import { customPackageRegistry } from "../../../src/registry/custom-registry.js";
import {
  getConnector,
  getPackageRegistry,
} from "../../../src/registry/index.js";

const mockedCustomPackageRegistry = vi.mocked(customPackageRegistry);
const mockedCatalogGet = vi.mocked(registryCatalog.get);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getPackageRegistry()", () => {
  it("returns registry from catalog factory for known key", async () => {
    const fakeRegistry = { packageName: "test" };
    const fakeDescriptor = {
      factory: vi.fn().mockResolvedValue(fakeRegistry),
    };
    mockedCatalogGet.mockReturnValue(fakeDescriptor as any);

    const result = await getPackageRegistry("npm", "/path/to/pkg");

    expect(mockedCatalogGet).toHaveBeenCalledWith("npm");
    expect(fakeDescriptor.factory).toHaveBeenCalledWith("/path/to/pkg");
    expect(result).toBe(fakeRegistry);
  });

  it("passes packagePath to factory", async () => {
    const fakeDescriptor = {
      factory: vi.fn().mockResolvedValue({}),
    };
    mockedCatalogGet.mockReturnValue(fakeDescriptor as any);

    await getPackageRegistry("crates", "/path/to/crate");

    expect(fakeDescriptor.factory).toHaveBeenCalledWith("/path/to/crate");
  });

  it("returns custom registry for unknown key", async () => {
    mockedCatalogGet.mockReturnValue(undefined);
    const fakeCustom = { packageName: "custom" };
    mockedCustomPackageRegistry.mockResolvedValue(fakeCustom as any);

    const result = await getPackageRegistry(
      "https://custom.registry.io",
      "/path/to/pkg",
    );

    expect(mockedCustomPackageRegistry).toHaveBeenCalledWith("/path/to/pkg");
    expect(result).toBe(fakeCustom);
  });

  it("does not call customPackageRegistry for known key", async () => {
    mockedCatalogGet.mockReturnValue({
      factory: vi.fn().mockResolvedValue({}),
    } as any);

    await getPackageRegistry("npm", "/path/to/pkg");

    expect(mockedCustomPackageRegistry).not.toHaveBeenCalled();
  });
});

describe("getConnector()", () => {
  it("returns connector from catalog descriptor", () => {
    const fakeConnector = { ping: vi.fn() };
    const fakeDescriptor = {
      connector: vi.fn().mockReturnValue(fakeConnector),
    };
    mockedCatalogGet.mockReturnValue(fakeDescriptor as any);

    const result = getConnector("npm");

    expect(mockedCatalogGet).toHaveBeenCalledWith("npm");
    expect(fakeDescriptor.connector).toHaveBeenCalled();
    expect(result).toBe(fakeConnector);
  });

  it("throws for unknown registry key", () => {
    mockedCatalogGet.mockReturnValue(undefined);

    expect(() => getConnector("unknown-reg" as any)).toThrow(
      "Unknown registry: unknown-reg. Cannot create connector.",
    );
  });
});
