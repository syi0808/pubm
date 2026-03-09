import { createHash } from "node:crypto";

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
    // Match url/sha256 pairs based on the platform context
    const platformPatterns: Record<string, { os: string; cpu: string }> = {
      "darwin-arm64": { os: "on_macos", cpu: "arm" },
      "darwin-x64": { os: "on_macos", cpu: "intel" },
      "linux-arm64": { os: "on_linux", cpu: "arm" },
      "linux-x64": { os: "on_linux", cpu: "intel" },
    };

    const pattern = platformPatterns[asset.platform];
    if (!pattern) continue;

    // Find the section for this platform and update url/sha256
    const osBlockRegex = new RegExp(
      `(${pattern.os}\\s+do[\\s\\S]*?CPU::${pattern.cpu}\\?\\s*\\n\\s*)url\\s+"[^"]+"(\\s*\\n\\s*)sha256\\s+"[^"]+"`,
    );

    updated = updated.replace(
      osBlockRegex,
      `$1url "${asset.url}"$2sha256 "${asset.sha256}"`,
    );
  }

  return updated;
}

export function mapReleaseAssets(
  assets: { name: string; url: string; sha256: string }[],
): FormulaAsset[] {
  const platformMap: Record<string, FormulaAsset["platform"]> = {
    "darwin-arm64": "darwin-arm64",
    "darwin-x64": "darwin-x64",
    "linux-arm64": "linux-arm64",
    "linux-x64": "linux-x64",
  };

  const result: FormulaAsset[] = [];

  for (const asset of assets) {
    for (const [key, platform] of Object.entries(platformMap)) {
      if (asset.name.includes(key)) {
        result.push({ platform, url: asset.url, sha256: asset.sha256 });
        break;
      }
    }
  }

  return result;
}

export async function computeSha256FromUrl(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.statusText}`);
  }
  const buffer = await response.arrayBuffer();
  const hash = createHash("sha256").update(Buffer.from(buffer)).digest("hex");
  return hash;
}
