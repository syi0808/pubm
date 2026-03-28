import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const localesDir = path.join(__dirname, "../../../src/i18n/locales");

function loadLocale(locale: string): Record<string, string> {
  const filePath = path.join(localesDir, `${locale}.json`);
  return JSON.parse(readFileSync(filePath, "utf-8"));
}

const EN_MESSAGES = loadLocale("en");
const EN_KEYS = Object.keys(EN_MESSAGES).sort();
const LOCALES = ["ko", "zh-cn", "fr", "de", "es"];

describe("JSON integrity", () => {
  it("en.json has no empty values", () => {
    for (const [key, value] of Object.entries(EN_MESSAGES)) {
      expect(value, `Key "${key}" has empty value`).not.toBe("");
    }
  });

  for (const locale of LOCALES) {
    describe(locale, () => {
      it(`has the same keys as en.json`, () => {
        const localeMessages = loadLocale(locale);
        const localeKeys = Object.keys(localeMessages).sort();
        expect(localeKeys).toEqual(EN_KEYS);
      });

      it(`has no empty values`, () => {
        const localeMessages = loadLocale(locale);
        for (const [key, value] of Object.entries(localeMessages)) {
          expect(value, `Key "${key}" has empty value in ${locale}`).not.toBe(
            "",
          );
        }
      });

      it(`preserves ICU placeholders from en.json`, () => {
        const localeMessages = loadLocale(locale);
        // Extract top-level ICU variable names (e.g. {name}, {count, plural, ...})
        // by matching { followed by a valid identifier. We only capture the variable
        // name itself to avoid matching translated text inside plural arms.
        function extractVariableNames(msg: string): string[] {
          const names: string[] = [];
          // Match {identifier} or {identifier, ...} at any nesting depth
          const pattern = /\{([a-zA-Z_][a-zA-Z0-9_]*)(,|\})/g;
          let match: RegExpExecArray | null;
          while ((match = pattern.exec(msg)) !== null) {
            names.push(match[1]);
          }
          return names.sort();
        }

        for (const [key, enValue] of Object.entries(EN_MESSAGES)) {
          const enVars = extractVariableNames(enValue);
          const localeVars = extractVariableNames(localeMessages[key] ?? "");

          expect(
            localeVars,
            `Key "${key}" in ${locale} has different placeholders than en`,
          ).toEqual(enVars);
        }
      });
    });
  }
});
