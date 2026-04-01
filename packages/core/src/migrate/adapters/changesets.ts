import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type {
  ConvertResult,
  DetectResult,
  MigrationSource,
  ParsedMigrationConfig,
} from "../types.js";

const SKIPPED_DIR_ENTRIES = new Set(["config.json", "README.md", ".gitkeep"]);

const CHANGELOG_PRESET_MAP: Record<string, string> = {
  "@changesets/changelog-github": "github",
  "@changesets/changelog-git": "git",
};

interface ChangesetsConfig {
  changelog?: false | string | [string, unknown];
  access?: "public" | "restricted";
  baseBranch?: string;
  fixed?: string[][];
  linked?: string[][];
  updateInternalDependencies?: "patch" | "minor";
  ignore?: string[];
  privatePackages?: unknown;
  snapshot?: {
    prereleaseTemplate?: string;
  };
  [key: string]: unknown;
}

interface PreJson {
  mode: "pre" | "exit";
  tag: string;
}

function resolveChangelogPreset(
  changelog: false | string | [string, unknown],
): { enabled: boolean; preset?: string } {
  if (changelog === false) {
    return { enabled: false };
  }
  const changelogPkg = Array.isArray(changelog) ? changelog[0] : changelog;
  const preset =
    typeof changelogPkg === "string"
      ? CHANGELOG_PRESET_MAP[changelogPkg]
      : undefined;
  return { enabled: true, preset };
}

export const changesetsAdapter: MigrationSource = {
  name: "changesets",

  configFilePatterns: [".changeset/config.json"],

  async detect(cwd: string): Promise<DetectResult> {
    const configFile = path.join(cwd, ".changeset", "config.json");

    if (!existsSync(configFile)) {
      return { found: false, configFiles: [], relatedFiles: [] };
    }

    const changesetDir = path.dirname(configFile);
    const relatedFiles: string[] = [];

    try {
      const entries = readdirSync(changesetDir, { encoding: "utf-8" });
      for (const entry of entries) {
        if (SKIPPED_DIR_ENTRIES.has(entry)) continue;
        if (entry.endsWith(".md") || entry === "pre.json") {
          relatedFiles.push(path.join(changesetDir, entry));
        }
      }
    } catch {
      // ignore read errors
    }

    return {
      found: true,
      configFiles: [configFile],
      relatedFiles,
    };
  },

  async parse(files: string[], cwd: string): Promise<ParsedMigrationConfig> {
    const configFile = files.find(
      (f) => f.endsWith(path.sep + "config.json") || f.endsWith("/config.json"),
    );

    if (configFile === undefined) {
      return { source: "changesets", unmappable: [] };
    }

    const raw = readFileSync(configFile, "utf-8");
    const config = JSON.parse(raw) as ChangesetsConfig;

    const result: ParsedMigrationConfig = {
      source: "changesets",
      unmappable: [],
    };

    // git settings
    if (config.baseBranch !== undefined) {
      result.git = { branch: config.baseBranch };
    }

    // npm access
    if (config.access !== undefined) {
      result.npm = { publish: true, access: config.access };
    }

    // changelog
    if (config.changelog !== undefined) {
      const { enabled, preset } = resolveChangelogPreset(config.changelog);
      result.changelog = { enabled };
      if (preset !== undefined) {
        result.changelog.preset = preset;
      }
    }

    // monorepo settings
    const hasFixed = config.fixed !== undefined && config.fixed.length > 0;
    const hasLinked = config.linked !== undefined && config.linked.length > 0;
    const hasUpdateInternalDeps =
      config.updateInternalDependencies !== undefined;

    if (hasFixed || hasLinked || hasUpdateInternalDeps) {
      result.monorepo = {};
      if (hasFixed) result.monorepo.fixed = config.fixed;
      if (hasLinked) result.monorepo.linked = config.linked;
      if (hasUpdateInternalDeps)
        result.monorepo.updateInternalDeps = config.updateInternalDependencies;
    }

    // prerelease: check pre.json
    const preJsonPath = path.join(cwd, ".changeset", "pre.json");
    if (existsSync(preJsonPath)) {
      try {
        const preRaw = readFileSync(preJsonPath, "utf-8");
        const preData = JSON.parse(preRaw) as PreJson;
        if (preData.mode === "pre") {
          result.prerelease = { active: true, tag: preData.tag };
        }
      } catch {
        // ignore
      }
    }

    // ignore
    if (config.ignore !== undefined && config.ignore.length > 0) {
      result.ignore = config.ignore;
    }

    // snapshotTemplate
    if (config.snapshot?.prereleaseTemplate !== undefined) {
      result.snapshotTemplate = config.snapshot.prereleaseTemplate;
    }

    // unmappable
    if (config.privatePackages !== undefined) {
      result.unmappable.push({
        key: "privatePackages",
        value: config.privatePackages,
        reason: "pubm does not yet support private package version management",
      });
    }

    return result;
  },

  convert(_parsed: ParsedMigrationConfig): ConvertResult {
    return { config: {}, warnings: [] };
  },

  getCleanupTargets(detected: DetectResult): string[] {
    if (detected.configFiles.length === 0) return [];
    const configFile = detected.configFiles[0];
    if (configFile === undefined) return [];
    return [path.dirname(configFile)];
  },
};
