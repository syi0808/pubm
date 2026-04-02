import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import YAML from "yaml";
import type {
  ConvertResult,
  DetectResult,
  MigrationSource,
  ParsedMigrationConfig,
} from "../types.js";

const STANDALONE_CONFIG_FILES = [
  ".releaserc",
  ".releaserc.json",
  ".releaserc.yaml",
  ".releaserc.yml",
  ".releaserc.js",
  ".releaserc.cjs",
  ".releaserc.mjs",
  "release.config.js",
  "release.config.cjs",
  "release.config.mjs",
];

const PACKAGE_JSON = "package.json";

const KNOWN_PLUGIN_PATTERNS: RegExp[] = [
  /commit-analyzer/,
  /release-notes-generator/,
  /\/npm$/,
  /github/,
  /changelog/,
  /\/git$/,
  /exec/,
];

const EXEC_LIFECYCLE_MAP: Record<string, string> = {
  prepareCmd: "prepare",
  publishCmd: "publish",
  verifyConditionsCmd: "verifyConditions",
  analyzeCommitsCmd: "analyzeCommits",
  verifyReleaseCmd: "verifyRelease",
  generateNotesCmd: "generateNotes",
  successCmd: "success",
  failCmd: "fail",
  addChannelCmd: "addChannel",
};

interface SemanticReleaseBranchObject {
  name: string;
  prerelease?: string | boolean;
  range?: string;
  channel?: string;
  [key: string]: unknown;
}

type SemanticReleaseBranch = string | SemanticReleaseBranchObject;

interface SemanticReleaseConfig {
  branches?: SemanticReleaseBranch | SemanticReleaseBranch[];
  plugins?: Array<string | [string, Record<string, unknown>]>;
  tagFormat?: string;
  repositoryUrl?: string;
  extends?: string;
  ci?: boolean;
  dryRun?: boolean;
  [key: string]: unknown;
}

interface NormalizedPlugin {
  name: string;
  options: Record<string, unknown>;
}

function normalizePlugin(
  entry: string | [string, Record<string, unknown>],
): NormalizedPlugin {
  if (typeof entry === "string") {
    return { name: entry, options: {} };
  }
  return { name: entry[0], options: entry[1] ?? {} };
}

function findPlugin(
  plugins: NormalizedPlugin[],
  nameFragment: string,
): NormalizedPlugin | undefined {
  return plugins.find((p) => p.name.includes(nameFragment));
}

function extractBranch(
  branches: SemanticReleaseBranch | SemanticReleaseBranch[] | undefined,
): string | undefined {
  if (branches === undefined) return undefined;

  const list = Array.isArray(branches) ? branches : [branches];

  for (const branch of list) {
    if (typeof branch === "string") {
      return branch;
    }
    // Skip prerelease branches (have prerelease property)
    if (branch.prerelease !== undefined) continue;
    // Skip maintenance branches (have range property)
    if (branch.range !== undefined) continue;
    return branch.name;
  }

  return undefined;
}

function extractPrereleaseBranches(
  branches: SemanticReleaseBranch | SemanticReleaseBranch[] | undefined,
): Array<{ name: string; prerelease: string | true }> | undefined {
  if (branches === undefined) return undefined;

  const list = Array.isArray(branches) ? branches : [branches];
  const result: Array<{ name: string; prerelease: string | true }> = [];

  for (const branch of list) {
    if (typeof branch === "string") continue;
    if (branch.prerelease !== undefined && branch.prerelease !== false) {
      result.push({
        name: branch.name,
        prerelease:
          branch.prerelease === true ? true : String(branch.prerelease),
      });
    }
  }

  return result.length > 0 ? result : undefined;
}

async function loadConfigFile(
  filePath: string,
): Promise<SemanticReleaseConfig> {
  if (
    filePath.endsWith(".js") ||
    filePath.endsWith(".cjs") ||
    filePath.endsWith(".mjs")
  ) {
    try {
      const mod = await import(filePath);
      /* istanbul ignore next */
      return ((mod.default ?? mod) as SemanticReleaseConfig) ?? {};
    } catch {
      return {};
    }
  }

  const raw = readFileSync(filePath, "utf-8");

  if (filePath.endsWith(".yaml") || filePath.endsWith(".yml")) {
    return YAML.parse(raw) as SemanticReleaseConfig;
  }

  if (
    filePath.endsWith(path.sep + PACKAGE_JSON) ||
    filePath.endsWith("/" + PACKAGE_JSON)
  ) {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return (parsed["release"] ?? {}) as SemanticReleaseConfig;
  }

  // .releaserc (no extension): try JSON first, fallback to YAML
  const basename = path.basename(filePath);
  if (basename === ".releaserc") {
    try {
      return JSON.parse(raw) as SemanticReleaseConfig;
    } catch {
      return YAML.parse(raw) as SemanticReleaseConfig;
    }
  }

  // .releaserc.json — parse as JSON
  try {
    return JSON.parse(raw) as SemanticReleaseConfig;
  } catch {
    return {};
  }
}

function mapConfigToParsed(
  config: SemanticReleaseConfig,
): ParsedMigrationConfig {
  const result: ParsedMigrationConfig = {
    source: "semantic-release",
    unmappable: [],
  };

  // tagFormat → git.tagFormat
  if (config.tagFormat !== undefined) {
    result.git = result.git ?? {};
    result.git.tagFormat = config.tagFormat;
  }

  // branches → git.branch + prerelease.branches
  if (config.branches !== undefined) {
    const branch = extractBranch(config.branches);
    if (branch !== undefined) {
      result.git = result.git ?? {};
      result.git.branch = branch;
    }

    const prereleaseBranches = extractPrereleaseBranches(config.branches);
    if (prereleaseBranches !== undefined) {
      result.prerelease = { active: true, branches: prereleaseBranches };
    }
  }

  // plugins
  if (config.plugins !== undefined) {
    const normalized = config.plugins.map(normalizePlugin);

    // @semantic-release/commit-analyzer → changelog.preset
    const commitAnalyzer = findPlugin(normalized, "commit-analyzer");
    if (commitAnalyzer !== undefined) {
      if (commitAnalyzer.options.preset !== undefined) {
        result.changelog = result.changelog ?? { enabled: true };
        result.changelog.preset = String(commitAnalyzer.options.preset);
      }
    }

    // @semantic-release/npm → npm.publish, npm.publishPath
    const npmPlugin = normalized.find((p) => /\/npm$/.test(p.name));
    if (npmPlugin !== undefined) {
      result.npm = {
        publish: npmPlugin.options.npmPublish !== false,
      };
      if (npmPlugin.options.pkgRoot !== undefined) {
        result.npm.publishPath = String(npmPlugin.options.pkgRoot);
      }
    }

    // @semantic-release/github → github.release, github.draft, github.assets
    const githubPlugin = normalized.find((p) => p.name.includes("github"));
    if (githubPlugin !== undefined) {
      result.github = { release: true };
      if (githubPlugin.options.draftRelease !== undefined) {
        result.github.draft = Boolean(githubPlugin.options.draftRelease);
      }
      if (githubPlugin.options.assets !== undefined) {
        const rawAssets = githubPlugin.options.assets as Array<
          string | { path: string }
        >;
        result.github.assets = rawAssets.map((a) =>
          typeof a === "string" ? a : a.path,
        );
      }
    }

    // @semantic-release/changelog → changelog.enabled, changelog.file
    const changelogPlugin = findPlugin(normalized, "changelog");
    if (changelogPlugin !== undefined) {
      result.changelog = result.changelog ?? { enabled: true };
      result.changelog.enabled = true;
      if (changelogPlugin.options.changelogFile !== undefined) {
        result.changelog.file = String(changelogPlugin.options.changelogFile);
      }
    }

    // @semantic-release/git → git.commitMessage
    const gitPlugin = normalized.find((p) => /\/git$/.test(p.name));
    if (gitPlugin !== undefined) {
      if (gitPlugin.options.message !== undefined) {
        result.git = result.git ?? {};
        result.git.commitMessage = String(gitPlugin.options.message);
      }
    }

    // @semantic-release/exec → hooks
    const execPlugin = findPlugin(normalized, "exec");
    if (execPlugin !== undefined) {
      const hooks: Array<{ lifecycle: string; command: string }> = [];
      for (const [optKey, lifecycle] of Object.entries(EXEC_LIFECYCLE_MAP)) {
        const cmd = execPlugin.options[optKey];
        if (cmd !== undefined) {
          hooks.push({ lifecycle, command: String(cmd) });
        }
      }
      if (hooks.length > 0) {
        result.hooks = hooks;
      }
    }

    // Unmappable plugins
    for (const plugin of normalized) {
      const isKnown = KNOWN_PLUGIN_PATTERNS.some((pattern) =>
        pattern.test(plugin.name),
      );
      if (!isKnown) {
        result.unmappable.push({
          key: `plugins.${plugin.name}`,
          value: [plugin.name, plugin.options],
          reason: `pubm does not have a built-in equivalent for the ${plugin.name} plugin`,
        });
      }
    }
  }

  return result;
}

export const semanticReleaseAdapter: MigrationSource = {
  name: "semantic-release",

  configFilePatterns: [PACKAGE_JSON, ...STANDALONE_CONFIG_FILES],

  async detect(cwd: string): Promise<DetectResult> {
    const configFiles: string[] = [];

    // Check standalone config files
    for (const filename of STANDALONE_CONFIG_FILES) {
      const filePath = path.join(cwd, filename);
      if (existsSync(filePath)) {
        configFiles.push(filePath);
      }
    }

    // Check package.json for release key
    const pkgJsonPath = path.join(cwd, PACKAGE_JSON);
    if (existsSync(pkgJsonPath)) {
      try {
        const raw = readFileSync(pkgJsonPath, "utf-8");
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        if ("release" in parsed) {
          configFiles.push(pkgJsonPath);
        }
      } catch {
        // ignore parse errors
      }
    }

    return {
      found: configFiles.length > 0,
      configFiles,
      relatedFiles: [],
    };
  },

  async parse(files: string[], _cwd: string): Promise<ParsedMigrationConfig> {
    // Prefer standalone config file over package.json
    const standaloneFile = files.find((f) =>
      STANDALONE_CONFIG_FILES.some(
        (name) => f.endsWith(path.sep + name) || f.endsWith("/" + name),
      ),
    );
    const pkgJsonFile = files.find(
      (f) =>
        f.endsWith(path.sep + PACKAGE_JSON) || f.endsWith("/" + PACKAGE_JSON),
    );

    const configFile = standaloneFile ?? pkgJsonFile;
    if (configFile === undefined) {
      return {
        source: "semantic-release",
        unmappable: [],
      };
    }

    const config = await loadConfigFile(configFile);
    return mapConfigToParsed(config);
  },

  convert(_parsed: ParsedMigrationConfig): ConvertResult {
    return {
      config: {},
      warnings: [],
    };
  },

  getCleanupTargets(detected: DetectResult): string[] {
    return detected.configFiles.filter(
      (f) =>
        !f.endsWith(path.sep + PACKAGE_JSON) && !f.endsWith("/" + PACKAGE_JSON),
    );
  },
};
