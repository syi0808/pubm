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
			throw new Error('Failed to retrieve dist tags from npm.');
		}
	}

	async version() {
		try {
			return this.npm(['--version']);
		} catch {
			throw new Error('Failed to retrieve npm version.');
		}
	}

	async ping() {
		try {
			await this.npm(['ping']);
			return true;
		} catch {
			throw new Error('Failed to ping npm registry.');
		}
	}

	async publish() {
		return true;
	}
}
