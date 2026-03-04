import type {
	PubmConfig,
	ResolvedPubmConfig,
	SnapshotConfig,
	ValidateConfig,
} from './types.js';

const defaultValidate: Required<ValidateConfig> = {
	cleanInstall: true,
	entryPoints: true,
	extraneousFiles: true,
};

const defaultSnapshot: Required<SnapshotConfig> = {
	useCalculatedVersion: false,
	prereleaseTemplate: '{tag}-{timestamp}',
};

const defaultConfig = {
	versioning: 'independent' as const,
	branch: 'main',
	changelog: true as boolean | string,
	changelogFormat: 'default' as string,
	commit: false,
	access: 'public' as const,
	fixed: [] as string[][],
	linked: [] as string[][],
	updateInternalDependencies: 'patch' as const,
	ignore: [] as string[],
	tag: 'latest',
	contents: '.',
	saveToken: true,
	releaseDraft: true,
	releaseNotes: true,
	rollbackStrategy: 'individual' as const,
};

export function resolveConfig(config: PubmConfig): ResolvedPubmConfig {
	const packages = config.packages ?? [
		{ path: '.', registries: ['npm', 'jsr'] },
	];
	return {
		...defaultConfig,
		...config,
		packages,
		validate: { ...defaultValidate, ...config.validate },
		snapshot: { ...defaultSnapshot, ...config.snapshot },
	};
}
