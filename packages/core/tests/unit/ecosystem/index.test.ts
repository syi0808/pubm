import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/ecosystem/catalog.js", () => {
  const mockCatalog = {
    get: vi.fn(),
    detectAll: vi.fn(),
    all: vi.fn().mockReturnValue([]),
    register: vi.fn(),
  };
  return { ecosystemCatalog: mockCatalog, EcosystemCatalog: vi.fn() };
});

import { ecosystemCatalog } from "../../../src/ecosystem/catalog.js";
import { detectEcosystem } from "../../../src/ecosystem/index.js";

const mockedEcosystemCatalogDetectAll = vi.mocked(ecosystemCatalog.detectAll);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("detectEcosystem", () => {
  it("uses manifest-based detection to select ecosystem", async () => {
    class MockEcosystem {
      packagePath: string;
      constructor(path: string) {
        this.packagePath = path;
      }
    }
    mockedEcosystemCatalogDetectAll.mockResolvedValue([
      {
        key: "js",
        ecosystemClass: MockEcosystem,
      } as any,
    ]);

    const eco = await detectEcosystem("/some/path");
    expect(eco).toBeDefined();
    expect((eco as any).packagePath).toBe("/some/path");
    expect(mockedEcosystemCatalogDetectAll).toHaveBeenCalledWith("/some/path");
  });

  it("detects Rust ecosystem from manifest", async () => {
    class MockRustEcosystem {
      packagePath: string;
      constructor(path: string) {
        this.packagePath = path;
      }
    }
    mockedEcosystemCatalogDetectAll.mockResolvedValue([
      {
        key: "rust",
        ecosystemClass: MockRustEcosystem,
      } as any,
    ]);

    const eco = await detectEcosystem("/rust/path");
    expect(eco).toBeDefined();
    expect((eco as any).packagePath).toBe("/rust/path");
    expect(mockedEcosystemCatalogDetectAll).toHaveBeenCalledWith("/rust/path");
  });

  it("returns null when no ecosystem detected", async () => {
    mockedEcosystemCatalogDetectAll.mockResolvedValue([]);

    const eco = await detectEcosystem("/empty/path");
    expect(eco).toBeNull();
  });
});
