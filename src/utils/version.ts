import { getPackageJson } from './package-json.js';

export async function version({ cwd = process.cwd() } = {}) {
	const { version } = await getPackageJson({ cwd });

	return version;
}
