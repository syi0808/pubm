import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/registry/catalog.js", () => {
  const mockCatalog = {
    get: vi.fn(),
    all: vi.fn().mockReturnValue([]),
    getByEcosystem: vi.fn().mockReturnValue([]),
    register: vi.fn(),
  };
  return { registryCatalog: mockCatalog, RegistryCatalog: vi.fn() };
});

vi.mock("../../../src/ecosystem/catalog.js", () => {
  const mockCatalog = {
    get: vi.fn(),
    detect: vi.fn(),
    all: vi.fn().mockReturnValue([]),
    register: vi.fn(),
  };
  return { ecosystemCatalog: mockCatalog, EcosystemCatalog: vi.fn() };
});

import { ecosystemCatalog } from "../../../src/ecosystem/catalog.js";
import { detectEcosystem } from "../../../src/ecosystem/index.js";
import { registryCatalog } from "../../../src/registry/catalog.js";

const mockedRegistryCatalogGet = vi.mocked(registryCatalog.get);
const mockedEcosystemCatalogGet = vi.mocked(ecosystemCatalog.get);
const mockedEcosystemCatalogDetect = vi.mocked(ecosystemCatalog.detect);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("detectEcosystem", () => {
  it("uses registry hint to select ecosystem", async () => {
    class MockEcosystem {
      packagePath: string;
      constructor(path: string) {
        this.packagePath = path;
      }
    }
    mockedRegistryCatalogGet.mockReturnValue({ ecosystem: "js" } as any);
    mockedEcosystemCatalogGet.mockReturnValue({
      ecosystemClass: MockEcosystem,
    } as any);

    const eco = await detectEcosystem("/some/path", ["npm"]);
    expect(eco).toBeDefined();
    expect((eco as any).packagePath).toBe("/some/path");
    expect(mockedRegistryCatalogGet).toHaveBeenCalledWith("npm");
    expect(mockedEcosystemCatalogGet).toHaveBeenCalledWith("js");
  });

  it("falls back to detect when no registry hint", async () => {
    class MockRustEcosystem {
      packagePath: string;
      constructor(path: string) {
        this.packagePath = path;
      }
    }
    mockedEcosystemCatalogDetect.mockResolvedValue({
      key: "rust",
      ecosystemClass: MockRustEcosystem,
    } as any);

    const eco = await detectEcosystem("/rust/path");
    expect(eco).toBeDefined();
    expect((eco as any).packagePath).toBe("/rust/path");
    expect(mockedEcosystemCatalogDetect).toHaveBeenCalledWith("/rust/path");
  });

  it("returns null when no ecosystem detected", async () => {
    mockedEcosystemCatalogDetect.mockResolvedValue(null);

    const eco = await detectEcosystem("/empty/path");
    expect(eco).toBeNull();
  });

  it("returns null when registry hint has no ecosystem descriptor", async () => {
    mockedRegistryCatalogGet.mockReturnValue({ ecosystem: "unknown" } as any);
    mockedEcosystemCatalogGet.mockReturnValue(undefined);
    mockedEcosystemCatalogDetect.mockResolvedValue(null);

    const eco = await detectEcosystem("/path", ["unknown-reg"]);
    expect(eco).toBeNull();
  });
});
