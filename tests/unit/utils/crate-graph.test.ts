import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPackageName, mockDependencies } = vi.hoisted(() => ({
  mockPackageName: vi.fn(),
  mockDependencies: vi.fn(),
}));

vi.mock("../../../src/ecosystem/rust.js", () => {
  return {
    RustEcosystem: class {
      packageName = mockPackageName;
      dependencies = mockDependencies;
    },
  };
});

import { sortCratesByDependencyOrder } from "../../../src/utils/crate-graph.js";

beforeEach(() => {
  mockPackageName.mockReset();
  mockDependencies.mockReset();
});

describe("sortCratesByDependencyOrder", () => {
  it("returns single crate as-is", async () => {
    mockPackageName.mockResolvedValue("my-crate");
    mockDependencies.mockResolvedValue([]);

    const result = await sortCratesByDependencyOrder(["rust/crates/my-crate"]);
    expect(result).toEqual(["rust/crates/my-crate"]);
  });

  it("orders dependent crate after its dependency", async () => {
    mockPackageName
      .mockResolvedValueOnce("update-kit")
      .mockResolvedValueOnce("update-kit-cli");
    mockDependencies
      .mockResolvedValueOnce(["serde"])
      .mockResolvedValueOnce(["update-kit", "clap"]);

    const result = await sortCratesByDependencyOrder([
      "rust/crates/update-kit",
      "rust/crates/update-kit-cli",
    ]);

    const kitIndex = result.indexOf("rust/crates/update-kit");
    const cliIndex = result.indexOf("rust/crates/update-kit-cli");
    expect(kitIndex).toBeLessThan(cliIndex);
  });

  it("orders correctly even when input order is reversed", async () => {
    mockPackageName
      .mockResolvedValueOnce("update-kit-cli")
      .mockResolvedValueOnce("update-kit");
    mockDependencies
      .mockResolvedValueOnce(["update-kit", "clap"])
      .mockResolvedValueOnce(["serde"]);

    const result = await sortCratesByDependencyOrder([
      "rust/crates/update-kit-cli",
      "rust/crates/update-kit",
    ]);

    const kitIndex = result.indexOf("rust/crates/update-kit");
    const cliIndex = result.indexOf("rust/crates/update-kit-cli");
    expect(kitIndex).toBeLessThan(cliIndex);
  });

  it("handles three-level dependency chain", async () => {
    mockPackageName
      .mockResolvedValueOnce("core")
      .mockResolvedValueOnce("mid")
      .mockResolvedValueOnce("top");
    mockDependencies
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(["core"])
      .mockResolvedValueOnce(["mid"]);

    const result = await sortCratesByDependencyOrder([
      "crates/core",
      "crates/mid",
      "crates/top",
    ]);

    expect(result).toEqual(["crates/core", "crates/mid", "crates/top"]);
  });

  it("throws on circular dependency", async () => {
    mockPackageName
      .mockResolvedValueOnce("a")
      .mockResolvedValueOnce("b");
    mockDependencies
      .mockResolvedValueOnce(["b"])
      .mockResolvedValueOnce(["a"]);

    await expect(
      sortCratesByDependencyOrder(["crates/a", "crates/b"]),
    ).rejects.toThrow(/circular/i);
  });

  it("ignores external dependencies not in configured crates", async () => {
    mockPackageName
      .mockResolvedValueOnce("my-crate")
      .mockResolvedValueOnce("my-other");
    mockDependencies
      .mockResolvedValueOnce(["serde", "tokio"])
      .mockResolvedValueOnce(["reqwest"]);

    const result = await sortCratesByDependencyOrder([
      "crates/my-crate",
      "crates/my-other",
    ]);

    expect(result).toEqual(["crates/my-crate", "crates/my-other"]);
  });
});
