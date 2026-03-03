import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/ecosystem/js.js", () => ({
  JsEcosystem: class MockJsEcosystem {
    static detect = vi.fn();
    packagePath: string;
    constructor(path: string) {
      this.packagePath = path;
    }
  },
}));

vi.mock("../../../src/ecosystem/rust.js", () => ({
  RustEcosystem: class MockRustEcosystem {
    static detect = vi.fn();
    packagePath: string;
    constructor(path: string) {
      this.packagePath = path;
    }
  },
}));

import { detectEcosystem } from "../../../src/ecosystem/index.js";
import { JsEcosystem } from "../../../src/ecosystem/js.js";
import { RustEcosystem } from "../../../src/ecosystem/rust.js";

const mockedJsDetect = vi.mocked(JsEcosystem.detect);
const mockedRustDetect = vi.mocked(RustEcosystem.detect);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("detectEcosystem", () => {
  it("returns RustEcosystem when Cargo.toml detected", async () => {
    mockedRustDetect.mockResolvedValue(true);
    mockedJsDetect.mockResolvedValue(false);

    const eco = await detectEcosystem("/some/rust/path");
    expect(eco).toBeDefined();
    expect(eco!.packagePath).toBe("/some/rust/path");
  });

  it("returns JsEcosystem when package.json detected", async () => {
    mockedRustDetect.mockResolvedValue(false);
    mockedJsDetect.mockResolvedValue(true);

    const eco = await detectEcosystem("/some/js/path");
    expect(eco).toBeDefined();
    expect(eco!.packagePath).toBe("/some/js/path");
  });

  it("returns null when no manifest exists", async () => {
    mockedRustDetect.mockResolvedValue(false);
    mockedJsDetect.mockResolvedValue(false);

    const eco = await detectEcosystem("/empty/path");
    expect(eco).toBeNull();
  });

  it("uses registry hint to select ecosystem for crates", async () => {
    const eco = await detectEcosystem("/some/path", ["crates"]);
    expect(eco).toBeDefined();
    expect(eco!.packagePath).toBe("/some/path");
  });

  it("uses registry hint to select ecosystem for npm", async () => {
    const eco = await detectEcosystem("/some/path", ["npm"]);
    expect(eco).toBeDefined();
    expect(eco!.packagePath).toBe("/some/path");
  });
});
