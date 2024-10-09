import { exec } from 'tinyexec';
import { AbstractError } from '../error.js';
import { Registry } from './registry.js';

class NpmError extends AbstractError {
	name = 'npm Error';
}

export class NpmRegistry extends Registry {
	constructor(
		public packageName: string,
		public registry = 'https://registry.npmjs.org',
	) {
		super(packageName, registry);
	}

	async npm(args: string[]) {
		const { stdout, stderr } = await exec('npm', args);

		if (stderr) throw stderr;

		return stdout;
	}

	async isPublished() {
		try {
			const response = await fetch(`${this.registry}/${this.packageName}`);

			return response.status === 200;
		} catch (error) {
			throw new NpmError(
				`Failed to fetch \`${this.registry}/${this.packageName}\``,
				{ cause: error },
			);
		}
	}

	async username() {
		try {
			return (await this.npm(['whoami'])).trim();
		} catch (error) {
			throw new NpmError('Failed to run `npm whoami`', { cause: error });
		}
	}

	async collaborators() {
		try {
			return JSON.parse(
				await this.npm([
					'access',
					'list',
					'collaborators',
					this.packageName,
					'--json',
				]),
			);
		} catch (error) {
			throw new NpmError(
				`Failed to run \`npm access list collaborators ${this.packageName} --json\``,
				{ cause: error },
			);
		}
	}

	async hasPermission() {
		const username = await this.username();

		const collaborators = await this.collaborators();

		return !!collaborators[username]?.includes('write');
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

	async isPackageNameAvaliable() {
		return true;
	}
}
