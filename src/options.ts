import type { Options, ResolvedOptions } from './types/options.js';

export const defaultOptions: Omit<Options, 'version'> = {
	testScript: 'test',
	buildScript: 'build',
	branch: 'main',
	tag: 'latest',
	registries: ['npm', 'jsr'],
};

export function resolveOptions(options: Options): ResolvedOptions {
	const nextOptions = { ...defaultOptions, ...options };

	return nextOptions as ResolvedOptions;
}
