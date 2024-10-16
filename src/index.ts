import { resolveOptions } from './options.js';
import { run } from './tasks/runner.js';
import type { Options } from './types/options.js';

/**
 * Runs the `pubm` function with the provided options.
 *
 * This function executes the publish process using the specified options.
 * The `version` field in the `options` parameter is required for the function
 * to run correctly.
 *
 * @async
 * @function
 */
export async function pubm(options: Options): Promise<void> {
	const resolvedOptions = resolveOptions({ ...options });

	await run(resolvedOptions);
}

/**
 * Options for configuring the {@linkcode pubm} function.
 */
export type { Options } from './types/options.js';
