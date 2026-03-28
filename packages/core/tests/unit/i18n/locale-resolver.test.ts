import { afterEach, describe, expect, it, vi } from "vitest";
import {
  normalizeLocale,
  resolveLocale,
} from "../../../src/i18n/locale-resolver.js";

describe("normalizeLocale", () => {
  it("strips encoding suffix", () => {
    expect(normalizeLocale("ko_KR.UTF-8")).toBe("ko");
  });

  it("converts underscore region to hyphen lowercase", () => {
    expect(normalizeLocale("zh_CN")).toBe("zh-cn");
  });

  it("extracts language from full locale", () => {
    expect(normalizeLocale("en_US")).toBe("en");
  });

  it("returns en for unsupported locale", () => {
    expect(normalizeLocale("ja_JP")).toBe("en");
  });

  it("handles already-normalized locale", () => {
    expect(normalizeLocale("ko")).toBe("ko");
  });

  it("returns en for undefined", () => {
    expect(normalizeLocale(undefined)).toBe("en");
  });

  it("returns en for empty string", () => {
    expect(normalizeLocale("")).toBe("en");
  });
});

describe("resolveLocale", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses flag when provided", () => {
    vi.stubEnv("PUBM_LOCALE", "fr");
    expect(resolveLocale({ flag: "ko" })).toBe("ko");
  });

  it("falls back to PUBM_LOCALE env", () => {
    vi.stubEnv("PUBM_LOCALE", "de");
    expect(resolveLocale({})).toBe("de");
  });

  it("falls back to config locale", () => {
    expect(resolveLocale({ configLocale: "es" })).toBe("es");
  });

  it("falls back to system locale via LANG", () => {
    vi.stubEnv("LANG", "fr_FR.UTF-8");
    expect(resolveLocale({})).toBe("fr");
  });

  it("falls back to en when nothing is set", () => {
    vi.stubEnv("LANG", "");
    vi.stubEnv("LC_ALL", "");
    vi.stubEnv("LC_MESSAGES", "");
    vi.stubEnv("PUBM_LOCALE", "");
    expect(resolveLocale({})).toBe("en");
  });

  it("respects priority: flag > env > config > system", () => {
    vi.stubEnv("PUBM_LOCALE", "fr");
    vi.stubEnv("LANG", "de_DE.UTF-8");
    expect(resolveLocale({ flag: "ko", configLocale: "es" })).toBe("ko");
  });
});
