import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("tinyexec", () => ({
  exec: vi.fn(),
}));

import { exec } from "tinyexec";
import { CratesRegistry } from "../../../src/registry/crates.js";

const mockedExec = vi.mocked(exec);

let mockedFetch: ReturnType<typeof vi.fn>;
let registry: CratesRegistry;

beforeEach(() => {
  vi.clearAllMocks();
  mockedFetch = vi.fn();
  vi.stubGlobal("fetch", mockedFetch);
  registry = new CratesRegistry("my-crate");
});

function mockStdout(stdout: string) {
  mockedExec.mockResolvedValue({ stdout, stderr: "" } as any);
}

describe("getRequirements", () => {
  it("returns needsPackageScripts false and requiredManifest Cargo.toml", () => {
    const registry = new CratesRegistry("my-crate");
    const requirements = registry.getRequirements();
    expect(requirements).toEqual({
      needsPackageScripts: false,
      requiredManifest: "Cargo.toml",
    });
  });
});

describe("CratesRegistry", () => {
  it("has crates.io registry url", () => {
    expect(registry.registry).toBe("https://crates.io");
  });

  describe("ping()", () => {
    it("returns true when crates.io API responds", async () => {
      mockedFetch.mockResolvedValue({ ok: true });
      const result = await registry.ping();
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
      await expect(registry.ping()).rejects.toThrow("Failed to ping crates.io");
    });
  });

  describe("isInstalled()", () => {
    it("returns true when cargo is available", async () => {
      mockStdout("cargo 1.75.0");
      expect(await registry.isInstalled()).toBe(true);
      expect(mockedExec).toHaveBeenCalledWith("cargo", ["--version"]);
    });

    it("returns false when cargo is not found", async () => {
      mockedExec.mockRejectedValue(new Error("not found"));
      expect(await registry.isInstalled()).toBe(false);
    });
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
        ["publish"],
        expect.objectContaining({ throwOnError: true }),
      );
    });

    it("throws on publish failure", async () => {
      mockedExec.mockRejectedValue(new Error("publish failed"));
      await expect(registry.publish()).rejects.toThrow(
        "Failed to run `cargo publish`",
      );
    });

    it("passes --manifest-path when manifestDir is provided", async () => {
      mockStdout("Uploading my-crate v1.0.0");
      expect(await registry.publish("packages/my-crate")).toBe(true);
      expect(mockedExec).toHaveBeenCalledWith(
        "cargo",
        [
          "publish",
          "--manifest-path",
          path.join("packages/my-crate", "Cargo.toml"),
        ],
        expect.objectContaining({ throwOnError: true }),
      );
    });

    it("constructs manifest path by joining manifestDir with Cargo.toml", async () => {
      mockStdout("Uploading my-crate v1.0.0");
      await registry.publish("some/nested/dir");
      const callArgs = mockedExec.mock.calls[0];
      expect(callArgs[1]).toContain("--manifest-path");
      expect(callArgs[1]).toContain(path.join("some/nested/dir", "Cargo.toml"));
    });

    it("throws on publish failure with manifest path", async () => {
      mockedExec.mockRejectedValue(new Error("publish failed"));
      await expect(registry.publish("packages/my-crate")).rejects.toThrow(
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

  describe("isPackageNameAvaliable()", () => {
    it("returns true when crate name is not taken", async () => {
      mockedFetch.mockResolvedValue({ ok: false, status: 404 });
      expect(await registry.isPackageNameAvaliable()).toBe(true);
    });

    it("returns false when crate name is taken", async () => {
      mockedFetch.mockResolvedValue({ ok: true });
      expect(await registry.isPackageNameAvaliable()).toBe(false);
    });

    it("throws CratesError on network error instead of returning true", async () => {
      mockedFetch.mockRejectedValue(new Error("network error"));
      await expect(registry.isPackageNameAvaliable()).rejects.toThrow(
        "Failed to check package name availability on crates.io",
      );
    });
  });
});
