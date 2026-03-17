import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const FIXTURE_PATH = path.resolve(__dirname, "../../fixtures/basic");

vi.mock("../../../src/utils/exec.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../../src/utils/exec.js")>();
  return {
    ...original,
    exec: vi.fn(),
  };
});

import {
  CratesConnector,
  CratesPackageRegistry,
} from "../../../src/registry/crates.js";
import { exec } from "../../../src/utils/exec.js";

const mockedExec = vi.mocked(exec);

let mockedFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockedFetch = vi.fn();
  vi.stubGlobal("fetch", mockedFetch);
});

function mockStdout(stdout: string) {
  mockedExec.mockResolvedValue({ stdout, stderr: "" } as any);
}

describe("CratesConnector", () => {
  let connector: CratesConnector;

  beforeEach(() => {
    connector = new CratesConnector();
  });

  it("has crates.io registry url", () => {
    expect(connector.registryUrl).toBe("https://crates.io");
  });

  describe("ping()", () => {
    it("returns true when crates.io API responds", async () => {
      mockedFetch.mockResolvedValue({ ok: true });
      const result = await connector.ping();
      expect(result).toBe(true);
      expect(mockedFetch).toHaveBeenCalledWith(
        "https://crates.io/api/v1",
        expect.objectContaining({
          headers: expect.objectContaining({
            "User-Agent": expect.stringContaining("pubm"),
          }),
        }),
      );
    });

    it("throws when crates.io is unreachable", async () => {
      mockedFetch.mockRejectedValue(new Error("network error"));
      await expect(connector.ping()).rejects.toThrow(
        "Failed to ping crates.io",
      );
    });
  });

  describe("isInstalled()", () => {
    it("returns true when cargo is available", async () => {
      mockStdout("cargo 1.75.0");
      expect(await connector.isInstalled()).toBe(true);
      expect(mockedExec).toHaveBeenCalledWith("cargo", ["--version"]);
    });

    it("returns false when cargo is not found", async () => {
      mockedExec.mockRejectedValue(new Error("not found"));
      expect(await connector.isInstalled()).toBe(false);
    });
  });

  describe("version()", () => {
    it("returns cargo version string", async () => {
      mockStdout("cargo 1.75.0 (abc123 2024-01-01)");
      const result = await connector.version();
      expect(result).toBe("cargo 1.75.0 (abc123 2024-01-01)");
    });

    it("throws when cargo is not found", async () => {
      mockedExec.mockRejectedValue(new Error("not found"));
      await expect(connector.version()).rejects.toThrow(
        "Failed to run `cargo --version`",
      );
    });
  });
});

describe("CratesPackageRegistry", () => {
  let registry: CratesPackageRegistry;

  beforeEach(() => {
    registry = new CratesPackageRegistry("my-crate", FIXTURE_PATH);
  });

  describe("getRequirements", () => {
    it("returns needsPackageScripts false and requiredManifest Cargo.toml", () => {
      const requirements = registry.getRequirements();
      expect(requirements).toEqual({
        needsPackageScripts: false,
        requiredManifest: "Cargo.toml",
      });
    });
  });

  it("has crates.io registry url", () => {
    expect(registry.registry).toBe("https://crates.io");
  });

  describe("distTags()", () => {
    it("returns empty array", async () => {
      expect(await registry.distTags()).toEqual([]);
    });
  });

  describe("version()", () => {
    it("returns latest version from crates.io API", async () => {
      mockedFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ crate: { max_version: "1.2.3" } }),
      });
      expect(await registry.version()).toBe("1.2.3");
    });

    it("throws with 'not found' message on 404", async () => {
      mockedFetch.mockResolvedValue({ ok: false, status: 404 });
      await expect(registry.version()).rejects.toThrow(/not found/i);
    });

    it("throws with 'API error' message on 5xx", async () => {
      mockedFetch.mockResolvedValue({ ok: false, status: 500 });
      await expect(registry.version()).rejects.toThrow(/API error.*HTTP 500/i);
    });

    it("throws with 'Cannot reach' message on network error", async () => {
      mockedFetch.mockRejectedValue(new Error("network failure"));
      await expect(registry.version()).rejects.toThrow(/cannot reach/i);
    });
  });

  describe("publish()", () => {
    it("returns true on successful cargo publish", async () => {
      mockStdout("Uploading my-crate v1.0.0");
      expect(await registry.publish()).toBe(true);
      expect(mockedExec).toHaveBeenCalledWith(
        "cargo",
        ["publish", "--manifest-path", path.join(FIXTURE_PATH, "Cargo.toml")],
        expect.objectContaining({ throwOnError: true }),
      );
    });

    it("throws on publish failure", async () => {
      mockedExec.mockRejectedValue(new Error("publish failed"));
      await expect(registry.publish()).rejects.toThrow(
        "Failed to run `cargo publish`",
      );
    });

    it("passes --manifest-path from packagePath", async () => {
      mockStdout("Uploading my-crate v1.0.0");
      expect(await registry.publish()).toBe(true);
      expect(mockedExec).toHaveBeenCalledWith(
        "cargo",
        ["publish", "--manifest-path", path.join(FIXTURE_PATH, "Cargo.toml")],
        expect.objectContaining({ throwOnError: true }),
      );
    });

    it("includes cargo stderr in error message when available", async () => {
      const { NonZeroExitError } = await import("../../../src/utils/exec.js");
      const error = new NonZeroExitError("cargo", 101, {
        stdout: "",
        stderr: "error: crate `update-kit` does not exist on crates.io",
      });
      mockedExec.mockRejectedValue(error);

      await expect(registry.publish()).rejects.toThrow(
        /crate `update-kit` does not exist/,
      );
    });

    it("throws on publish failure with packagePath", async () => {
      mockedExec.mockRejectedValue(new Error("publish failed"));
      await expect(registry.publish()).rejects.toThrow(
        "Failed to run `cargo publish`",
      );
    });
  });

  describe("isPublished()", () => {
    it("returns true when crate exists", async () => {
      mockedFetch.mockResolvedValue({ ok: true });
      expect(await registry.isPublished()).toBe(true);
    });

    it("returns false when crate does not exist", async () => {
      mockedFetch.mockResolvedValue({ ok: false, status: 404 });
      expect(await registry.isPublished()).toBe(false);
    });
  });

  describe("hasPermission()", () => {
    it("returns true when CARGO_REGISTRY_TOKEN env is set", async () => {
      process.env.CARGO_REGISTRY_TOKEN = "test-token";
      expect(await registry.hasPermission()).toBe(true);
      delete process.env.CARGO_REGISTRY_TOKEN;
    });

    it("returns true when cargo is installed (fallback)", async () => {
      mockStdout("cargo 1.75.0");
      expect(await registry.hasPermission()).toBe(true);
    });
  });

  describe("dryRunPublish()", () => {
    it("runs cargo publish --dry-run", async () => {
      mockStdout("");
      await registry.dryRunPublish();
      expect(mockedExec).toHaveBeenCalledWith(
        "cargo",
        [
          "publish",
          "--dry-run",
          "--manifest-path",
          path.join(FIXTURE_PATH, "Cargo.toml"),
        ],
        expect.objectContaining({ throwOnError: true }),
      );
    });

    it("passes --manifest-path from packagePath", async () => {
      mockStdout("");
      await registry.dryRunPublish();
      expect(mockedExec).toHaveBeenCalledWith(
        "cargo",
        [
          "publish",
          "--dry-run",
          "--manifest-path",
          path.join(FIXTURE_PATH, "Cargo.toml"),
        ],
        expect.objectContaining({ throwOnError: true }),
      );
    });

    it("throws on dry-run failure", async () => {
      mockedExec.mockRejectedValue(new Error("dry-run failed"));
      await expect(registry.dryRunPublish()).rejects.toThrow(
        "Failed to run `cargo publish --dry-run`",
      );
    });

    it("filters noise lines from cargo stderr", async () => {
      const { NonZeroExitError } = await import("../../../src/utils/exec.js");
      const error = new NonZeroExitError("cargo", 101, {
        stdout: "",
        stderr:
          "    Updating crates.io index\nwarning: manifest has no description\n    Updating crates.io index\nerror: failed to prepare local package",
      });
      mockedExec.mockRejectedValue(error);

      try {
        await registry.dryRunPublish();
      } catch (e: any) {
        expect(e.message).not.toContain("Updating crates.io index");
        expect(e.message).toContain("warning: manifest has no description");
        expect(e.message).toContain("error: failed to prepare local package");
      }
    });
  });

  describe("isPackageNameAvailable()", () => {
    it("returns true when crate name is not taken", async () => {
      mockedFetch.mockResolvedValue({ ok: false, status: 404 });
      expect(await registry.isPackageNameAvailable()).toBe(true);
    });

    it("returns false when crate name is taken", async () => {
      mockedFetch.mockResolvedValue({ ok: true });
      expect(await registry.isPackageNameAvailable()).toBe(false);
    });

    it("throws CratesError on network error instead of returning true", async () => {
      mockedFetch.mockRejectedValue(new Error("network error"));
      await expect(registry.isPackageNameAvailable()).rejects.toThrow(
        "Failed to check package name availability on crates.io",
      );
    });
  });
});
