import type {
  PubmConfig,
  ResolvedPubmConfig,
  SnapshotConfig,
  ValidateConfig,
} from "./types.js";

const defaultValidate: Required<ValidateConfig> = {
  cleanInstall: true,
  entryPoints: true,
  extraneousFiles: true,
};

const defaultSnapshot: Required<SnapshotConfig> = {
  useCalculatedVersion: false,
  prereleaseTemplate: "{tag}-{timestamp}",
};

const defaultConfig = {
  versioning: "independent" as const,
  branch: "main",
  changelog: true as boolean | string,
  changelogFormat: "default" as string,
  commit: false,
  access: "public" as const,
  fixed: [] as string[][],
  linked: [] as string[][],
  updateInternalDependencies: "patch" as const,
  ignore: [] as string[],
  tag: "latest",
  contents: ".",
  saveToken: true,
  releaseDraft: true,
  releaseNotes: true,
  rollbackStrategy: "individual" as const,
};

export function resolveConfig(config: PubmConfig): ResolvedPubmConfig {
  if (config.registries) {
    console.warn(
      '[pubm] The global "registries" field is deprecated. Registries are now inferred from manifest files or specified per-package in the "packages" array.',
    );
  }

  const { registries: _ignored, ...configWithoutRegistries } = config;
  const packages = config.packages ?? [{ path: "." }];
  return {
    ...defaultConfig,
    ...configWithoutRegistries,
    packages,
    validate: { ...defaultValidate, ...config.validate },
    snapshot: { ...defaultSnapshot, ...config.snapshot },
    plugins: config.plugins ?? [],
  };
}
