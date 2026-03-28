export const SUPPORTED_LOCALES = [
  "en",
  "ko",
  "zh-cn",
  "fr",
  "de",
  "es",
] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export function isSupportedLocale(locale: string): locale is SupportedLocale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(locale);
}
