import { satisfies } from 'semver';
import { type Engine, getPackageJson } from './package-json.js';

export async function validateEngineVersion(engine: Engine, version: string) {
	const { engine: engineField } = await getPackageJson({
		cwd: import.meta.dirname,
	});

	return satisfies(version, engineField[engine], { includePrerelease: true });
}
