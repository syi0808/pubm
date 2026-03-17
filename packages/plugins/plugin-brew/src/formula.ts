import type { ReleaseAsset } from "@pubm/core";
import type { AssetPlatformMatcher } from "./types.js";

export interface FormulaAsset {
  platform: "darwin-arm64" | "darwin-x64" | "linux-arm64" | "linux-x64";
  url: string;
  sha256: string;
}

export interface GenerateFormulaOptions {
  name: string;
  desc: string;
  homepage: string;
  license: string;
  version: string;
  assets: FormulaAsset[];
}

function toClassName(name: string): string {
  return name
    .split(/[-_]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

function findAsset(
  assets: FormulaAsset[],
  platform: FormulaAsset["platform"],
): FormulaAsset | undefined {
  return assets.find((a) => a.platform === platform);
}

export function generateFormula(opts: GenerateFormulaOptions): string {
  const className = toClassName(opts.name);
  const darwinArm64 = findAsset(opts.assets, "darwin-arm64");
  const darwinX64 = findAsset(opts.assets, "darwin-x64");
  const linuxArm64 = findAsset(opts.assets, "linux-arm64");
  const linuxX64 = findAsset(opts.assets, "linux-x64");

  return `class ${className} < Formula
  desc "${opts.desc}"
  homepage "${opts.homepage}"
  version "${opts.version}"
  license "${opts.license}"

  on_macos do
    if Hardware::CPU.arm?
      url "${darwinArm64?.url ?? "PLACEHOLDER"}"
      sha256 "${darwinArm64?.sha256 ?? "PLACEHOLDER"}"
    elsif Hardware::CPU.intel?
      url "${darwinX64?.url ?? "PLACEHOLDER"}"
      sha256 "${darwinX64?.sha256 ?? "PLACEHOLDER"}"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "${linuxArm64?.url ?? "PLACEHOLDER"}"
      sha256 "${linuxArm64?.sha256 ?? "PLACEHOLDER"}"
    elsif Hardware::CPU.intel?
      url "${linuxX64?.url ?? "PLACEHOLDER"}"
      sha256 "${linuxX64?.sha256 ?? "PLACEHOLDER"}"
    end
  end

  def install
    bin.install "${opts.name}"
  end

  test do
    system "#{bin}/${opts.name}", "--version"
  end
end
`;
}

export function updateFormula(
  content: string,
  version: string,
  assets: FormulaAsset[],
): string {
  let updated = content.replace(/version\s+"[^"]+"/, `version "${version}"`);

  for (const asset of assets) {
    const platformPatterns: Record<string, { os: string; cpu: string }> = {
      "darwin-arm64": { os: "on_macos", cpu: "arm" },
      "darwin-x64": { os: "on_macos", cpu: "intel" },
      "linux-arm64": { os: "on_linux", cpu: "arm" },
      "linux-x64": { os: "on_linux", cpu: "intel" },
    };

    const pattern = platformPatterns[asset.platform];
    if (!pattern) continue;

    const osBlockRegex = new RegExp(
      `(${pattern.os}\\s+do[\\s\\S]*?Hardware::CPU\\.${pattern.cpu}\\?\\s*\\n\\s*)url\\s+"[^"]+"(\\s*\\n\\s*)sha256\\s+"[^"]+"`,
      "m",
    );

    updated = updated.replace(
      osBlockRegex,
      `$1url "${asset.url}"$2sha256 "${asset.sha256}"`,
    );
  }

  return updated;
}

const FORMULA_PLATFORMS = {
  "darwin-arm64": { os: "darwin", arch: "arm64" },
  "darwin-x64": { os: "darwin", arch: "x64" },
  "linux-arm64": { os: "linux", arch: "arm64" },
  "linux-x64": { os: "linux", arch: "x64" },
} as const;

export type FormulaPlatformKey = keyof typeof FORMULA_PLATFORMS;

export function matchAssetToPlatform(
  assets: ReleaseAsset[],
  formulaPlatform: FormulaPlatformKey,
  customMatcher?: AssetPlatformMatcher,
): ReleaseAsset | undefined {
  if (customMatcher) return assets.find(customMatcher);
  const { os, arch } = FORMULA_PLATFORMS[formulaPlatform];
  return assets.find((a) => a.platform.os === os && a.platform.arch === arch);
}

export function releaseAssetsToFormulaAssets(
  assets: ReleaseAsset[],
  customMatchers?: Record<string, AssetPlatformMatcher>,
): FormulaAsset[] {
  const result: FormulaAsset[] = [];
  for (const key of Object.keys(FORMULA_PLATFORMS) as FormulaPlatformKey[]) {
    const matched = matchAssetToPlatform(assets, key, customMatchers?.[key]);
    if (matched) {
      result.push({
        platform: key,
        url: matched.url,
        sha256: matched.sha256,
      });
    }
  }
  return result;
}
