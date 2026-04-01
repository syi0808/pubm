import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type {
  ConvertResult,
  DetectResult,
  MigrationSource,
  ParsedMigrationConfig,
} from "../types.js";

const STANDALONE_CONFIG_FILES = [
  ".np-config.json",
  ".np-config.js",
  ".np-config.cjs",
  ".np-config.mjs",
];

const PACKAGE_JSON = "package.json";

/** np options that are runtime-only and should be silently ignored */
const RUNTIME_ONLY_KEYS = new Set([
  "yolo",
  "preview",
  "packageManager",
  "cleanup",
  "anyBranch",
]);

/** np options that cannot be mapped to pubm config */
const UNMAPPABLE_KEYS: Record<string, string> = {
  "2fa": "npm 2FA is managed at the npm account level, not via pubm config",
  provenance: "provenance is an npm CLI flag and is not configurable in pubm",
};

interface NpConfig {
  branch?: string;
  tests?: boolean;
  testScript?: string;
  publish?: boolean;
  tag?: string;
  contents?: string;
  releaseDraft?: boolean;
  cleanup?: boolean;
  message?: string;
  anyBranch?: boolean;
  "2fa"?: boolean;
  provenance?: boolean;
  yolo?: boolean;
  preview?: boolean;
  packageManager?: string;
  [key: string]: unknown;
}

function readNpConfig(filePath: string, isPackageJson: boolean): NpConfig {
  const raw = readFileSync(filePath, "utf-8");
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  if (isPackageJson) {
    return (parsed["np"] ?? {}) as NpConfig;
  }
  return parsed as NpConfig;
}

function mapNpConfigToParsed(
  npConfig: NpConfig,
  source: "np",
): ParsedMigrationConfig {
  const result: ParsedMigrationConfig = {
    source,
    unmappable: [],
  };

  // git settings
  const gitBranch = npConfig.branch;
  const commitMessage = npConfig.message;
  if (gitBranch !== undefined || commitMessage !== undefined) {
    result.git = {};
    if (gitBranch !== undefined) {
      result.git.branch = gitBranch;
    }
    if (commitMessage !== undefined) {
      result.git.commitMessage = commitMessage;
    }
  }

  // tests settings
  const testsEnabled = npConfig.tests;
  const testScript = npConfig.testScript;
  if (testsEnabled !== undefined || testScript !== undefined) {
    result.tests = {
      enabled: testsEnabled !== false,
    };
    if (testScript !== undefined) {
      result.tests.script = testScript;
    }
  }

  // npm settings
  const publish = npConfig.publish;
  const tag = npConfig.tag;
  const publishPath = npConfig.contents;
  if (publish !== undefined || tag !== undefined || publishPath !== undefined) {
    result.npm = {
      publish: publish !== false,
    };
    if (tag !== undefined) {
      result.npm.tag = tag;
    }
    if (publishPath !== undefined) {
      result.npm.publishPath = publishPath;
    }
  }

  // github release settings
  const releaseDraft = npConfig.releaseDraft;
  if (releaseDraft !== undefined) {
    result.github = {
      release: true,
      draft: releaseDraft,
    };
  }

  // cleanInstall (np cleanup option)
  if (npConfig.cleanup !== undefined) {
    result.cleanInstall = npConfig.cleanup;
  }

  // anyBranch — stored as a flag to emit a warning in converter
  if (npConfig.anyBranch === true) {
    result.anyBranch = true;
  }

  // unmappable keys (skip runtime-only keys silently)
  for (const [key, value] of Object.entries(npConfig)) {
    if (RUNTIME_ONLY_KEYS.has(key)) continue;
    const reason = UNMAPPABLE_KEYS[key];
    if (reason !== undefined) {
      result.unmappable.push({ key, value, reason });
    }
  }

  return result;
}

export const npAdapter: MigrationSource = {
  name: "np",

  configFilePatterns: [PACKAGE_JSON, ...STANDALONE_CONFIG_FILES],

  async detect(cwd: string): Promise<DetectResult> {
    const configFiles: string[] = [];

    // Check standalone config files first
    for (const filename of STANDALONE_CONFIG_FILES) {
      const filePath = path.join(cwd, filename);
      if (existsSync(filePath)) {
        configFiles.push(filePath);
      }
    }

    // Check package.json for np key
    const pkgJsonPath = path.join(cwd, PACKAGE_JSON);
    if (existsSync(pkgJsonPath)) {
      try {
        const raw = readFileSync(pkgJsonPath, "utf-8");
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        if ("np" in parsed) {
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
        source: "np",
        unmappable: [],
      };
    }

    const isPackageJson =
      configFile === pkgJsonFile && standaloneFile === undefined;
    const npConfig = readNpConfig(configFile, isPackageJson);

    return mapNpConfigToParsed(npConfig, "np");
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
