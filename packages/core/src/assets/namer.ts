import { basename, extname } from "node:path";
import type { CompressedAsset, CompressFormat } from "./types.js";

export function getExtension(format: CompressFormat | false): string {
  if (format === false) return "";
  return `.${format}`;
}

export function applyNameTemplate(
  asset: CompressedAsset,
  context: { name: string; version: string },
): string {
  const { platform, compressFormat, originalPath, config } = asset;
  const template = config.name;

  const originalExt = extname(originalPath);
  const filename = basename(originalPath, originalExt);

  const vars: Record<string, string | undefined> = {
    name: context.name,
    version: context.version,
    platform: platform.raw || undefined,
    os: platform.os,
    arch: platform.arch,
    vendor: platform.vendor,
    abi: platform.abi,
    variant: platform.variant,
    filename,
  };

  let result = template.replace(/\{(\w+)\}/g, (_match, key: string) => {
    return vars[key] ?? "";
  });

  // Clean up empty segments: remove double separators left by undefined vars
  result = result.replace(/[-_]{2,}/g, (m) => m[0]);
  result = result.replace(/^[-_]+|[-_]+$/g, "");

  // Append extension
  if (compressFormat !== false) {
    result += getExtension(compressFormat);
  } else {
    result += originalExt;
  }

  return result;
}
