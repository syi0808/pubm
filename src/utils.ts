import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

interface PackageJson {
	version: string;
}

const cachedPackageJson: Record<string, PackageJson> = {};

export async function getPackageJson({ cwd = process.cwd() } = {}) {
	if (cachedPackageJson[cwd]) return cachedPackageJson[cwd];

	let directory = cwd;
	let filePath: string;
	const { root } = path.parse(cwd);

	while (directory && directory !== root) {
		filePath = path.join(directory, 'package.json');

		try {
			if ((await stat(filePath)).isFile()) {
				break;
			}
		} catch {}

		directory = path.dirname(directory);
	}

	try {
		const packageJson = JSON.parse(
			(await readFile(path.join(directory, 'package.json'))).toString(),
		);
		cachedPackageJson[cwd] = packageJson;

		return packageJson as PackageJson;
	} catch (error) {
		throw new Error('root package.json is not json format.');
	}
}
