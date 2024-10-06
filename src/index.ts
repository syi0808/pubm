import { resolveOptions } from './options.js';
import type { Options } from './types/options.js';

export async function pubm(options: Options) {
	const resolvedOptions = resolveOptions({ ...options });

	console.log(resolvedOptions);

	return resolvedOptions;
}
