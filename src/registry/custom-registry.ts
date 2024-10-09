import { exec } from 'tinyexec';
import { getPackageJson } from '../utils/package.js';
import { NpmRegistry } from './npm.js';

export class CustomRegistry extends NpmRegistry {
	async npm(args: string[]) {
		const { stdout, stderr } = await exec(
			'npm',
			args.concat('--registry', this.registry),
		);

		if (stderr) throw stderr;

		return stdout;
	}
}

export async function customRegistry() {
	const packageJson = await getPackageJson();

	return new CustomRegistry(packageJson.name);
}
