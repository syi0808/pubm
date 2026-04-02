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
  ".release-it.json",
  ".release-it.yaml",
  ".release-it.yml",
  ".release-it.js",
  ".release-it.cjs",
  ".release-it.ts",
];

const PACKAGE_JSON = "package.json";

const CONVENTIONAL_CHANGELOG_PLUGIN = "@release-it/conventional-changelog";

interface ReleaseItGit {
  commitMessage?: string;
  tagName?: string;
  requireBranch?: string | string[] | false;
  requireCleanWorkingDir?: boolean;
  [key: string]: unknown;
}

interface ReleaseItNpm {
  publish?: boolean;
  publishPath?: string;
  tag?: string;
  [key: string]: unknown;
}

interface ReleaseItGithub {
  release?: boolean;
  draft?: boolean;
  assets?: string[];
  [key: string]: unknown;
}

interface ReleaseItGitlab {
  [key: string]: unknown;
}

interface ConventionalChangelogPlugin {
  infile?: string;
  preset?: string;
  [key: string]: unknown;
}

interface ReleaseItConfig {
  git?: ReleaseItGit;
  npm?: ReleaseItNpm | false;
  github?: ReleaseItGithub | false;
  gitlab?: ReleaseItGitlab | false;
  hooks?: Record<string, string | string[]>;
  plugins?: Record<string, unknown>;
  extends?: string;
  [key: string]: unknown;
}

async function loadConfigFile(filePath: string): Promise<ReleaseItConfig> {
  if (
    filePath.endsWith(".js") ||
    filePath.endsWith(".cjs") ||
    filePath.endsWith(".ts")
  ) {
    try {
      const mod = await import(filePath);
      /* istanbul ignore next */
      return ((mod.default ?? mod) as ReleaseItConfig) ?? {};
    } catch {
      return {};
    }
  }

  const raw = readFileSync(filePath, "utf-8");

  if (filePath.endsWith(".yaml") || filePath.endsWith(".yml")) {
    return YAML.parse(raw) as ReleaseItConfig;
  }

  if (
    filePath.endsWith(path.sep + PACKAGE_JSON) ||
    filePath.endsWith("/" + PACKAGE_JSON)
  ) {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return (parsed["release-it"] ?? {}) as ReleaseItConfig;
  }

  return JSON.parse(raw) as ReleaseItConfig;
}

function parseHooks(
  hooks: Record<string, string | string[]>,
): Array<{ lifecycle: string; command: string }> {
  const result: Array<{ lifecycle: string; command: string }> = [];
  for (const [lifecycle, value] of Object.entries(hooks)) {
    if (Array.isArray(value)) {
      for (const command of value) {
        result.push({ lifecycle, command });
      }
    } else {
      result.push({ lifecycle, command: value });
    }
  }
  return result;
}

function mapConfigToParsed(config: ReleaseItConfig): ParsedMigrationConfig {
  const result: ParsedMigrationConfig = {
    source: "release-it",
    unmappable: [],
  };

  // git settings
  if (config.git !== undefined) {
    const git = config.git;
    const hasGitFields =
      git.commitMessage !== undefined ||
      git.tagName !== undefined ||
      git.requireBranch !== undefined ||
      git.requireCleanWorkingDir !== undefined;

    if (hasGitFields) {
      result.git = {};

      if (git.commitMessage !== undefined) {
        result.git.commitMessage = git.commitMessage;
      }

      if (git.tagName !== undefined) {
        result.git.tagFormat = git.tagName;
      }

      if (git.requireBranch !== undefined && git.requireBranch !== false) {
        if (Array.isArray(git.requireBranch)) {
          if (git.requireBranch.length > 0) {
            result.git.branch = git.requireBranch[0];
          }
        } else {
          result.git.branch = git.requireBranch;
        }
      }

      if (git.requireCleanWorkingDir !== undefined) {
        result.git.requireCleanWorkdir = git.requireCleanWorkingDir;
      }
    }
  }

  // npm settings
  if (config.npm !== undefined) {
    if (config.npm === false) {
      result.npm = { publish: false };
    } else {
      const npm = config.npm;
      result.npm = {
        publish: npm.publish !== false,
      };
      if (npm.publishPath !== undefined) {
        result.npm.publishPath = npm.publishPath;
      }
      if (npm.tag !== undefined) {
        result.npm.tag = npm.tag;
      }
    }
  }

  // github settings
  if (config.github !== undefined && config.github !== false) {
    const github = config.github;
    result.github = {
      release: github.release !== false,
    };
    if (github.draft !== undefined) {
      result.github.draft = github.draft;
    }
    if (github.assets !== undefined) {
      result.github.assets = github.assets;
    }
  }

  // gitlab: unmappable
  if (config.gitlab !== undefined && config.gitlab !== false) {
    result.unmappable.push({
      key: "gitlab",
      value: config.gitlab,
      reason: "pubm does not support GitLab releases",
    });
  }

  // hooks
  if (config.hooks !== undefined) {
    result.hooks = parseHooks(config.hooks);
  }

  // plugins
  if (config.plugins !== undefined) {
    for (const [pluginName, pluginConfig] of Object.entries(config.plugins)) {
      if (pluginName === CONVENTIONAL_CHANGELOG_PLUGIN) {
        const ccConfig = pluginConfig as ConventionalChangelogPlugin;
        result.changelog = { enabled: true };
        if (ccConfig.infile !== undefined) {
          result.changelog.file = ccConfig.infile;
        }
        if (ccConfig.preset !== undefined) {
          result.changelog.preset = ccConfig.preset;
        }
      } else {
        result.unmappable.push({
          key: `plugins.${pluginName}`,
          value: pluginConfig,
          reason: `pubm does not have a built-in equivalent for the ${pluginName} plugin`,
        });
      }
    }
  }

  return result;
}

export const releaseItAdapter: MigrationSource = {
  name: "release-it",

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

    // Check package.json for release-it key
    const pkgJsonPath = path.join(cwd, PACKAGE_JSON);
    if (existsSync(pkgJsonPath)) {
      try {
        const raw = readFileSync(pkgJsonPath, "utf-8");
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        if ("release-it" in parsed) {
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
        source: "release-it",
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
