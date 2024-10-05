import type { Options, ResolvedOptions } from './types/options';

const defaultOptions: Omit<Options, 'version'> = {
	testScript: 'test',
	branch: 'main',
	skipCleanup: true,
	tag: 'latest',
};

export function resolveOptions(options: Options): ResolvedOptions {
	const nextOptions = { ...options, ...defaultOptions };

	return nextOptions as ResolvedOptions;
}
