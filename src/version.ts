import { getPackageJson } from './utils';

export async function version({ cwd = process.cwd() } = {}) {
	const { version } = await getPackageJson({ cwd });

	return version;
}
