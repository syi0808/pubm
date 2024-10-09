import { satisfies } from 'semver';
import type { Engine } from '../types/package-json.js';
import { getPackageJson } from './package.js';

export async function validateEngineVersion(engine: Engine, version: string) {
	const { engines } = await getPackageJson({
		cwd: import.meta.dirname,
	});

	return satisfies(version, `${engines?.[engine]}`, {
		includePrerelease: true,
	});
}
