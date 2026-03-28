import { createIntl, createIntlCache } from "@formatjs/intl";
import { resolveLocale } from "./locale-resolver.js";

// Static imports — bundled by Bun.build
import de from "./locales/de.json" with { type: "json" };
import en from "./locales/en.json" with { type: "json" };
import es from "./locales/es.json" with { type: "json" };
import fr from "./locales/fr.json" with { type: "json" };
import ko from "./locales/ko.json" with { type: "json" };
import zhCn from "./locales/zh-cn.json" with { type: "json" };
import type { SupportedLocale } from "./types.js"

const allMessages: Record<string, Record<string, string>> = {
  en,
  ko,
  "zh-cn": zhCn,
  fr,
  de,
  es,
};

const cache = createIntlCache();
let currentLocale: SupportedLocale = "en";
let intl = createIntl({ locale: "en", messages: en }, cache);

export function initI18n(options: {
  flag?: string;
  configLocale?: string;
}): void {
  currentLocale = resolveLocale(options);
  const messages = {
    ...allMessages.en,
    ...(allMessages[currentLocale] ?? {}),
  };
  intl = createIntl({ locale: currentLocale, messages }, cache);
}

export function t(
  key: string,
  values?: Record<string, string | number | boolean>,
): string {
  if (!intl.messages[key]) {
    return key;
  }
  return intl.formatMessage({ id: key, defaultMessage: key }, values);
}

export function getLocale(): SupportedLocale {
  return currentLocale;
}

export { resolveLocale } from "./locale-resolver.js";
export type { SupportedLocale } from "./types.js";
export { SUPPORTED_LOCALES } from "./types.js";
