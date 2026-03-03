import type { RegistryType } from './options.js';

export interface PackageConfig {
	path: string;
	registries: RegistryType[];
	buildCommand?: string;
	testCommand?: string;
}

export interface PubmConfig {
	versioning?: 'independent' | 'fixed';
	packages?: PackageConfig[];
	registries?: RegistryType[];
	branch?: string;
	tag?: string;
	skipTests?: boolean;
	skipBuild?: boolean;
	skipPublish?: boolean;
	skipReleaseDraft?: boolean;
}
