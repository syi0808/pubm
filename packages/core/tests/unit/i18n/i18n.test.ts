import { beforeEach, describe, expect, it } from "vitest";
import { getLocale, initI18n, t } from "../../../src/i18n/index.js";

describe("i18n", () => {
  beforeEach(() => {
    initI18n({ flag: "en" });
  });

  describe("initI18n", () => {
    it("sets locale to en by default", () => {
      initI18n({});
      expect(getLocale()).toBe("en");
    });

    it("sets locale from flag", () => {
      initI18n({ flag: "ko" });
      expect(getLocale()).toBe("ko");
    });
  });

  describe("t", () => {
    it("returns translated string for known key", () => {
      initI18n({ flag: "en" });
      expect(t("label.warning")).toBe("WARNING");
    });

    it("returns key as fallback for unknown key", () => {
      initI18n({ flag: "en" });
      expect(t("nonexistent.key")).toBe("nonexistent.key");
    });

    it("interpolates ICU variables", () => {
      initI18n({ flag: "en" });
      expect(t("rollback.skippedConfirmation", { label: "Unpublish" })).toBe(
        "Skipped: Unpublish (requires confirmation)",
      );
    });

    it("handles numeric variables", () => {
      initI18n({ flag: "en" });
      const result = t("rollback.success", { succeeded: 2, total: 3 });
      expect(result).toBe("Rollback completed (2/3)");
    });
  });

  describe("getLocale", () => {
    it("returns current locale", () => {
      initI18n({ flag: "de" });
      expect(getLocale()).toBe("de");
    });
  });
});
