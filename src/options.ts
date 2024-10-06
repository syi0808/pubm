import type { Options, ResolvedOptions } from './types/options.js';

const defaultOptions: Omit<Options, 'version'> = {
	testScript: 'test',
	branch: 'main',
	skipCleanup: true,
	tag: 'latest',
	registries: ['npm', 'jsr'],
};

export function resolveOptions(options: Options): ResolvedOptions {
	const nextOptions = { ...options, ...defaultOptions };

	return nextOptions as ResolvedOptions;
}
