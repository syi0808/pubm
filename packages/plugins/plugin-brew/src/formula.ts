import type { ReleaseAsset } from "@pubm/core";
import type { AssetPlatformMatcher } from "./types.js";

export interface FormulaAsset {
  platform:
    | "darwin-arm64"
    | "darwin-x64"
    | "darwin-x64-baseline"
    | "linux-arm64"
    | "linux-arm64-musl"
    | "linux-x64"
    | "linux-x64-baseline"
    | "linux-x64-musl"
    | "linux-x64-musl-baseline";
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
  const linuxArm64Musl = findAsset(opts.assets, "linux-arm64-musl");
  const linuxX64 = findAsset(opts.assets, "linux-x64");
  const linuxX64Musl = findAsset(opts.assets, "linux-x64-musl");

  const hasMusl = linuxArm64Musl || linuxX64Musl;

  let linuxBlock: string;
  if (hasMusl) {
    linuxBlock = `  on_linux do
    if Hardware::CPU.arm?
      if OS::Linux.libc_is_musl?
        url "${linuxArm64Musl?.url ?? "PLACEHOLDER"}"
        sha256 "${linuxArm64Musl?.sha256 ?? "PLACEHOLDER"}"
      else
        url "${linuxArm64?.url ?? "PLACEHOLDER"}"
        sha256 "${linuxArm64?.sha256 ?? "PLACEHOLDER"}"
      end
    elsif Hardware::CPU.intel?
      if OS::Linux.libc_is_musl?
        url "${linuxX64Musl?.url ?? "PLACEHOLDER"}"
        sha256 "${linuxX64Musl?.sha256 ?? "PLACEHOLDER"}"
      else
        url "${linuxX64?.url ?? "PLACEHOLDER"}"
        sha256 "${linuxX64?.sha256 ?? "PLACEHOLDER"}"
      end
    end
  end`;
  } else {
    linuxBlock = `  on_linux do
    if Hardware::CPU.arm?
      url "${linuxArm64?.url ?? "PLACEHOLDER"}"
      sha256 "${linuxArm64?.sha256 ?? "PLACEHOLDER"}"
    elsif Hardware::CPU.intel?
      url "${linuxX64?.url ?? "PLACEHOLDER"}"
      sha256 "${linuxX64?.sha256 ?? "PLACEHOLDER"}"
    end
  end`;
  }

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

${linuxBlock}

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
    const isMusl =
      asset.platform === "linux-arm64-musl" ||
      asset.platform === "linux-x64-musl";

    const platformPatterns: Record<
      string,
      { os: string; cpu: string; musl?: boolean }
    > = {
      "darwin-arm64": { os: "on_macos", cpu: "arm" },
      "darwin-x64": { os: "on_macos", cpu: "intel" },
      "linux-arm64": { os: "on_linux", cpu: "arm" },
      "linux-arm64-musl": { os: "on_linux", cpu: "arm", musl: true },
      "linux-x64": { os: "on_linux", cpu: "intel" },
      "linux-x64-musl": { os: "on_linux", cpu: "intel", musl: true },
    };

    const pattern = platformPatterns[asset.platform];
    if (!pattern) continue;

    let osBlockRegex: RegExp;
    if (isMusl) {
      // Match the musl? branch within the CPU block
      osBlockRegex = new RegExp(
        `(${pattern.os}\\s+do[\\s\\S]*?Hardware::CPU\\.${pattern.cpu}\\?\\s*\\n[\\s\\S]*?libc_is_musl\\?\\s*\\n\\s*)url\\s+"[^"]+"(\\s*\\n\\s*)sha256\\s+"[^"]+"`,
        "m",
      );
    } else if (pattern.os === "on_linux") {
      // For non-musl Linux, match the else branch (after musl check) or direct branch (no musl)
      const muslCheck = new RegExp(
        `${pattern.os}\\s+do[\\s\\S]*?Hardware::CPU\\.${pattern.cpu}\\?[\\s\\S]*?libc_is_musl\\?`,
      );
      if (muslCheck.test(updated)) {
        // Has musl branches — match the else branch
        osBlockRegex = new RegExp(
          `(${pattern.os}\\s+do[\\s\\S]*?Hardware::CPU\\.${pattern.cpu}\\?\\s*\\n[\\s\\S]*?libc_is_musl\\?\\s*\\n\\s*url\\s+"[^"]+"\\s*\\n\\s*sha256\\s+"[^"]+"\\s*\\n\\s*else\\s*\\n\\s*)url\\s+"[^"]+"(\\s*\\n\\s*)sha256\\s+"[^"]+"`,
          "m",
        );
      } else {
        // No musl branches — match directly
        osBlockRegex = new RegExp(
          `(${pattern.os}\\s+do[\\s\\S]*?Hardware::CPU\\.${pattern.cpu}\\?\\s*\\n\\s*)url\\s+"[^"]+"(\\s*\\n\\s*)sha256\\s+"[^"]+"`,
          "m",
        );
      }
    } else {
      osBlockRegex = new RegExp(
        `(${pattern.os}\\s+do[\\s\\S]*?Hardware::CPU\\.${pattern.cpu}\\?\\s*\\n\\s*)url\\s+"[^"]+"(\\s*\\n\\s*)sha256\\s+"[^"]+"`,
        "m",
      );
    }

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
  "darwin-x64-baseline": { os: "darwin", arch: "x64", variant: "baseline" },
  "linux-arm64": { os: "linux", arch: "arm64" },
  "linux-arm64-musl": { os: "linux", arch: "arm64", abi: "musl" },
  "linux-x64": { os: "linux", arch: "x64" },
  "linux-x64-baseline": { os: "linux", arch: "x64", variant: "baseline" },
  "linux-x64-musl": { os: "linux", arch: "x64", abi: "musl" },
  "linux-x64-musl-baseline": {
    os: "linux",
    arch: "x64",
    abi: "musl",
    variant: "baseline",
  },
} as const;

export type FormulaPlatformKey = keyof typeof FORMULA_PLATFORMS;

export function matchAssetToPlatform(
  assets: ReleaseAsset[],
  formulaPlatform: FormulaPlatformKey,
  customMatcher?: AssetPlatformMatcher,
): ReleaseAsset | undefined {
  if (customMatcher) return assets.find(customMatcher);
  const spec = FORMULA_PLATFORMS[formulaPlatform];
  return assets.find(
    (a) =>
      a.platform.os === spec.os &&
      a.platform.arch === spec.arch &&
      (a.platform.abi ?? undefined) ===
        ("abi" in spec ? spec.abi : undefined) &&
      (a.platform.variant ?? undefined) ===
        ("variant" in spec ? spec.variant : undefined),
  );
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
