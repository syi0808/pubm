export const locales = ["en", "ko", "zh-cn", "fr", "de", "es"] as const;

export type SiteLocale = (typeof locales)[number];

export const defaultLocale: SiteLocale = "en";

export const localeLabels: Record<SiteLocale, string> = {
  en: "English",
  ko: "한국어",
  "zh-cn": "简体中文",
  fr: "Français",
  de: "Deutsch",
  es: "Español",
};

export function isSiteLocale(value: string | undefined): value is SiteLocale {
  return value !== undefined && locales.includes(value as SiteLocale);
}

export function normalizeLocale(value: string | undefined): SiteLocale {
  return isSiteLocale(value) ? value : defaultLocale;
}

export function getLocalePath(locale: SiteLocale, path = ""): string {
  const normalizedPath = path.replace(/^\/+/, "");
  const base = import.meta.env.BASE_URL ?? "/";
  const normalizedBase = base.endsWith("/") ? base : `${base}/`;
  if (locale === defaultLocale) {
    return normalizedPath
      ? `${normalizedBase}${normalizedPath}`
      : normalizedBase;
  }
  return normalizedPath
    ? `${normalizedBase}${locale}/${normalizedPath}`
    : `${normalizedBase}${locale}/`;
}

export function getDocsPath(
  locale: SiteLocale,
  slug = "guides/quick-start",
): string {
  return getLocalePath(locale, slug);
}
