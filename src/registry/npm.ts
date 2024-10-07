import { exec } from 'tinyexec';
import { Registry } from './registry.js';

export class NpmRegistry extends Registry {
	constructor(public packageName: string) {
		super();
	}

	async npm(args: string[]) {
		return (await exec('npm', args, { throwOnError: true })).stdout;
	}

	async distTags() {
		return Object.keys(
			JSON.parse(
				await this.npm(['view', this.packageName, 'dist-tags', '--json']),
			),
		);
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
