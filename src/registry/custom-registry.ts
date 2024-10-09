import { exec } from 'tinyexec';
import { getPackageJson } from '../utils/package';
import { NpmRegistry } from './npm.js';

export class CustomRegistry extends NpmRegistry {
	packageName: string;

	constructor(packageName?: string, registry?: string) {
		const npmPackageName = packageName ?? getPackageJson()?.name;

		super(npmPackageName, registry);

		this.packageName = npmPackageName;
	}

	async npm(args: string[]) {
		const { stdout, stderr } = await exec(
			'npm',
			args.concat('--registry', this.registry),
		);

		if (stderr) throw stderr;

		return stdout;
	}
}
