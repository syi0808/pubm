import { describe, expect, it, vi } from "vitest";
import { CratesRegistry } from "../../../src/registry/crates.js";
import { JsrRegisry } from "../../../src/registry/jsr.js";
import { NpmRegistry } from "../../../src/registry/npm.js";

describe("isVersionPublished", () => {
  describe("NpmRegistry", () => {
    it("returns true when version exists (HTTP 200)", async () => {
      const npm = new NpmRegistry("test-package");
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(null, { status: 200 }),
      );

      expect(await npm.isVersionPublished("1.0.0")).toBe(true);
      expect(fetch).toHaveBeenCalledWith(
        "https://registry.npmjs.org/test-package/1.0.0",
      );
    });

    it("returns false when version does not exist (HTTP 404)", async () => {
      const npm = new NpmRegistry("test-package");
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(null, { status: 404 }),
      );

      expect(await npm.isVersionPublished("1.0.0")).toBe(false);
    });

    it("throws on network error", async () => {
      const npm = new NpmRegistry("test-package");
      vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(
        new Error("network error"),
      );

      await expect(npm.isVersionPublished("1.0.0")).rejects.toThrow();
    });
  });

  describe("CratesRegistry", () => {
    it("returns true when version exists (HTTP 200)", async () => {
      const crates = new CratesRegistry("test-crate");
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(null, { status: 200 }),
      );

      expect(await crates.isVersionPublished("1.0.0")).toBe(true);
      expect(fetch).toHaveBeenCalledWith(
        "https://crates.io/api/v1/crates/test-crate/1.0.0",
        expect.objectContaining({ headers: expect.any(Object) }),
      );
    });

    it("returns false when version does not exist (HTTP 404)", async () => {
      const crates = new CratesRegistry("test-crate");
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(null, { status: 404 }),
      );

      expect(await crates.isVersionPublished("1.0.0")).toBe(false);
    });
  });

  describe("JsrRegisry", () => {
    it("returns true when version exists (HTTP 200)", async () => {
      const jsr = new JsrRegisry("@scope/name");
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(null, { status: 200 }),
      );

      expect(await jsr.isVersionPublished("1.0.0")).toBe(true);
      expect(fetch).toHaveBeenCalledWith("https://jsr.io/@scope/name/1.0.0");
    });

    it("returns false when version does not exist (HTTP 404)", async () => {
      const jsr = new JsrRegisry("@scope/name");
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(null, { status: 404 }),
      );

      expect(await jsr.isVersionPublished("1.0.0")).toBe(false);
    });
  });
});
