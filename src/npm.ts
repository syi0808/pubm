import { exec } from 'tinyexec';
import { Registry } from './registry';

const NPM_DEFAULT_REGISTRIES = new Set([
	// https://docs.npmjs.com/cli/v10/using-npm/registry
	'https://registry.npmjs.org',
	// https://docs.npmjs.com/cli/v10/commands/npm-profile#registry
	'https://registry.npmjs.org/',
]);

export class NpmRegistry extends Registry {
	public async getUsername() {
		try {
			const { stdout, stderr } = await exec('npm', ['whoami']);

			if (stderr) throw new Error(stderr);

			return stdout;
		} catch (error) {
			if (/ENEEDAUTH/.test(`${error}`)) {
				throw new Error(
					'You must be logged in. Use `npm login` and try again.',
				);
			}

			throw new Error(
				'Authentication error. Use `npm whoami` to troubleshoot.',
			);
		}
	}

	public async getVersion() {
		const { stdout } = await exec('npm', ['--version']);

		return stdout;
	}

	public async checkConnection() {
		try {
			await exec('npm', ['ping'], { timeout: 15_000 });
			return true;
		} catch {
			throw new Error('Connection to npm registry failed');
		}
	}

	public async publish() {
		return true;
	}
}
