import { relative, resolve } from "node:path";
import { resolveCompressFormat } from "./compressor.js";
import { parsePlatform } from "./platform-parser.js";
import type {
  CompressOption,
  ParsedPlatform,
  ReleaseAssetEntry,
  ResolvedAsset,
} from "./types.js";

export interface NormalizedGroup {
  packagePath?: string;
  files: { path: string; compress?: CompressOption; name?: string }[];
  compress?: CompressOption;
  name?: string;
}

export function normalizeConfig(
  entries: ReleaseAssetEntry[],
  _globalCompress: CompressOption | undefined,
): NormalizedGroup[] {
  return entries.map((entry) => {
    if (typeof entry === "string") {
      return {
        files: [{ path: entry, compress: undefined, name: undefined }],
      };
    }
    return {
      packagePath: entry.packagePath,
      compress: entry.compress,
      name: entry.name,
      files: entry.files.map((f) => {
        if (typeof f === "string") {
          return { path: f, compress: undefined, name: undefined };
        }
        return { path: f.path, compress: f.compress, name: f.name };
      }),
    };
  });
}

export function pathPatternToGlob(pattern: string): string {
  return pattern.replace(/\{[^}]+\}/g, "*");
}

export function extractCaptureVars(
  pattern: string,
  actualPath: string,
): Record<string, string> {
  const vars: Record<string, string> = {};
  const captureNames: string[] = [];

  const regexStr = pattern.replace(/\{(\w+)\}/g, (_m, name: string) => {
    captureNames.push(name);
    // {platform} can span hyphens, individual vars match single tokens
    return name === "platform" ? "([^/]+)" : "([^/-]+)";
  });

  if (captureNames.length === 0) return vars;

  const match = actualPath.match(new RegExp(`^${regexStr}$`));
  if (match) {
    for (let i = 0; i < captureNames.length; i++) {
      vars[captureNames[i]] = match[i + 1];
    }
  }

  return vars;
}

export function resolveAssets(
  config: NormalizedGroup,
  globalCompress: CompressOption | undefined,
  cwd: string,
): ResolvedAsset[] {
  const results: ResolvedAsset[] = [];

  for (const file of config.files) {
    const globPattern = pathPatternToGlob(file.path);
    const baseDir = resolve(cwd, config.packagePath ?? "");
    const glob = new Bun.Glob(globPattern);
    const matches = [...glob.scanSync({ cwd: baseDir, absolute: true })];

    for (const matchPath of matches) {
      const relPath = relative(baseDir, matchPath);

      // Extract capture variables or auto-parse platform
      const capturedVars = extractCaptureVars(file.path, relPath);
      let platform: ParsedPlatform;

      if (Object.keys(capturedVars).length > 0) {
        if (capturedVars.platform) {
          platform = parsePlatform(capturedVars.platform);
        } else {
          // Individual captures: join and parse through parsePlatform
          // so aliases are resolved (e.g., win→windows, x86_64→x64)
          const joined = Object.values(capturedVars).join("-");
          platform = parsePlatform(joined);
        }
      } else {
        // Auto-parse from path segments
        let found: ParsedPlatform | undefined;
        const segments = relPath.split("/");
        for (const seg of segments) {
          const parsed = parsePlatform(seg);
          if (parsed.os || parsed.arch) {
            found = parsed;
            break;
          }
        }
        platform = found ?? { raw: "" };
      }

      // Resolve compress: file > group > global > auto
      const compress = resolveCompressFormat(
        matchPath,
        platform.os,
        file.compress ?? config.compress ?? globalCompress,
      );

      // Resolve name template
      const defaultName =
        platform.os || platform.arch ? "{filename}-{platform}" : "{filename}";
      const nameTemplate = file.name ?? config.name ?? defaultName;

      results.push({
        filePath: matchPath,
        platform,
        config: {
          path: file.path,
          compress,
          name: nameTemplate,
        },
      });
    }
  }

  return results;
}
