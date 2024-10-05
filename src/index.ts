import { resolveOptions } from './options';
import type { Options } from './types/options';

export async function pubm(options: Options) {
	const resolvedOptions = resolveOptions({ ...options });

	console.log(resolvedOptions);

	return resolvedOptions;
}
