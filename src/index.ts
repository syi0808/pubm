import { resolveOptions } from './options.js';
import { run } from './tasks/runner.js';
import type { Options } from './types/options.js';

export async function pubm(options: Options) {
	const resolvedOptions = resolveOptions({ ...options });

	await run(resolvedOptions);
}
