import { describe, expect, it } from "vitest";
import { parsePlatform } from "../../../src/assets/platform-parser.js";

describe("parsePlatform", () => {
  describe("auto-parsing from tokens", () => {
    it("parses darwin-arm64", () => {
      const result = parsePlatform("darwin-arm64");
      expect(result).toEqual({
        raw: "darwin-arm64",
        os: "darwin",
        arch: "arm64",
      });
    });
    it("parses linux-x64", () => {
      const result = parsePlatform("linux-x64");
      expect(result).toEqual({ raw: "linux-x64", os: "linux", arch: "x64" });
    });
    it("parses windows-x64", () => {
      const result = parsePlatform("windows-x64");
      expect(result).toEqual({
        raw: "windows-x64",
        os: "windows",
        arch: "x64",
      });
    });
    it("parses Rust triple x86_64-unknown-linux-gnu", () => {
      const result = parsePlatform("x86_64-unknown-linux-gnu");
      expect(result).toEqual({
        raw: "x86_64-unknown-linux-gnu",
        os: "linux",
        arch: "x64",
        vendor: "unknown",
        abi: "gnu",
      });
    });
    it("parses aarch64-apple-darwin", () => {
      const result = parsePlatform("aarch64-apple-darwin");
      expect(result).toEqual({
        raw: "aarch64-apple-darwin",
        os: "darwin",
        arch: "arm64",
        vendor: "apple",
      });
    });
    it("parses x86_64-pc-windows-msvc", () => {
      const result = parsePlatform("x86_64-pc-windows-msvc");
      expect(result).toEqual({
        raw: "x86_64-pc-windows-msvc",
        os: "windows",
        arch: "x64",
        vendor: "pc",
        abi: "msvc",
      });
    });
    it("parses linux-x64-baseline-musl", () => {
      const result = parsePlatform("linux-x64-baseline-musl");
      expect(result).toEqual({
        raw: "linux-x64-baseline-musl",
        os: "linux",
        arch: "x64",
        variant: "baseline",
        abi: "musl",
      });
    });
  });
  describe("OS aliases", () => {
    it("resolves macos to darwin", () => {
      expect(parsePlatform("macos-arm64").os).toBe("darwin");
    });
    it("resolves win to windows", () => {
      expect(parsePlatform("win-x64").os).toBe("windows");
    });
    it("resolves win32 to windows", () => {
      expect(parsePlatform("win32-x64").os).toBe("windows");
    });
  });
  describe("Arch aliases", () => {
    it("resolves x86_64 to x64", () => {
      expect(parsePlatform("linux-x86_64").arch).toBe("x64");
    });
    it("resolves amd64 to x64", () => {
      expect(parsePlatform("linux-amd64").arch).toBe("x64");
    });
    it("resolves aarch64 to arm64", () => {
      expect(parsePlatform("linux-aarch64").arch).toBe("arm64");
    });
    it("resolves i686 to ia32", () => {
      expect(parsePlatform("linux-i686").arch).toBe("ia32");
    });
  });
  describe("ABI detection", () => {
    it("detects musl", () => {
      expect(parsePlatform("linux-x64-musl").abi).toBe("musl");
    });
    it("detects gnu", () => {
      expect(parsePlatform("linux-x64-gnu").abi).toBe("gnu");
    });
    it("detects gnueabihf", () => {
      expect(parsePlatform("linux-arm-gnueabihf").abi).toBe("gnueabihf");
    });
    it("detects msvc", () => {
      expect(parsePlatform("windows-x64-msvc").abi).toBe("msvc");
    });
  });
  describe("Variant detection", () => {
    it("detects baseline", () => {
      expect(parsePlatform("linux-x64-baseline").variant).toBe("baseline");
    });
    it("detects v3", () => {
      expect(parsePlatform("linux-x64-v3").variant).toBe("v3");
    });
  });
  describe("unknown tokens", () => {
    it("ignores unknown tokens", () => {
      const result = parsePlatform("foobar-linux-x64-baz");
      expect(result.os).toBe("linux");
      expect(result.arch).toBe("x64");
    });
    it("returns empty fields when nothing matches", () => {
      const result = parsePlatform("foobar-baz");
      expect(result).toEqual({ raw: "foobar-baz" });
    });
  });
});
