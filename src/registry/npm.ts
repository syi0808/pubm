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
		try {
			return Object.keys(
				JSON.parse(
					await this.npm(['view', this.packageName, 'dist-tags', '--json']),
				),
			);
		} catch {
			throw new Error('failed get dist tags on npm');
		}
	}

	async checkPermission() {
		return '';
	}

	async getVersion() {
		try {
			return this.npm(['--version']);
		} catch {
			throw new Error('failed get version of npm');
		}
	}

	async ping() {
		try {
			await this.npm(['ping']);
			return true;
		} catch {
			throw new Error('failed ping to npm registry');
		}
	}

	async publish() {
		return true;
	}
}
