import { isSupportedLocale, type SupportedLocale } from "./types.js";

export function normalizeLocale(raw: string | undefined): SupportedLocale {
  if (!raw) return "en";

  // Strip encoding (e.g., "ko_KR.UTF-8" → "ko_KR")
  const withoutEncoding = raw.split(".")[0];

  // Try full locale with hyphen-lowercase (e.g., "zh_CN" → "zh-cn")
  const hyphenated = withoutEncoding.replace("_", "-").toLowerCase();
  if (isSupportedLocale(hyphenated)) return hyphenated;

  // Try language-only (e.g., "ko_KR" → "ko", "en_US" → "en")
  const language = withoutEncoding.split(/[_-]/)[0].toLowerCase();
  if (isSupportedLocale(language)) return language;

  return "en";
}

function getSystemLocale(): string | undefined {
  return (
    process.env.LANG ||
    process.env.LC_ALL ||
    process.env.LC_MESSAGES ||
    undefined
  );
}

export function resolveLocale(options: {
  flag?: string;
  configLocale?: string;
}): SupportedLocale {
  const raw =
    options.flag ??
    (process.env.PUBM_LOCALE || undefined) ??
    options.configLocale ??
    getSystemLocale();

  return normalizeLocale(raw);
}
