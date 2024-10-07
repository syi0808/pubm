import { exec } from 'tinyexec';
import { Registry } from './registry.js';

// const NPM_DEFAULT_REGISTRIES = new Set([
// 	// https://docs.npmjs.com/cli/v10/using-npm/registry
// 	'https://registry.npmjs.org',
// 	// https://docs.npmjs.com/cli/v10/commands/npm-profile#registry
// 	'https://registry.npmjs.org/',
// ]);

export class NpmRegistry extends Registry {
	async npm(args: string[]) {
		return (await exec('npm', args, { throwOnError: true })).stdout;
	}

	async checkPermission() {
		return '';
	}

	async getVersion() {
		const { stdout } = await exec('npm', ['--version']);

		return stdout;
	}

	async ping() {
		try {
			await exec('npm', ['ping']);
			return true;
		} catch {
			throw new Error('Connection to npm registry failed');
		}
	}

	async publish() {
		return true;
	}
}
