import { exec } from 'tinyexec';
import { AbstractError } from '../error.js';
import { isValidPackageName } from '../utils/package-name.js';
import { getPackageJson } from '../utils/package.js';
import { Registry } from './registry.js';

class NpmError extends AbstractError {
	name = 'npm Error';
}

export class NpmRegistry extends Registry {
	registry = 'https://registry.npmjs.org';

	protected async npm(args: string[]): Promise<string> {
		const { stdout, stderr } = await exec('npm', args);

		if (stderr) throw stderr;

		return stdout;
	}

	async isInstalled(): Promise<boolean> {
		try {
			await this.npm(['--help']);

			return true;
		} catch {
			return false;
		}
	}

	async installGlobally(packageName: string): Promise<boolean> {
		try {
			await this.npm(['install', '-g', packageName]);

			return true;
		} catch (error) {
			throw new NpmError(`Failed to run \`npm install -g ${packageName}\``, {
				cause: error,
			});
		}
	}

	async isPublished(): Promise<boolean> {
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

	async userName(): Promise<string> {
		try {
			return (await this.npm(['whoami'])).trim();
		} catch (error) {
			throw new NpmError('Failed to run `npm whoami`', { cause: error });
		}
	}

	async isLoggedIn(): Promise<boolean> {
		try {
			await this.npm(['whoami']);

			return true;
		} catch (error) {
			if (`${error}`.includes('ENEEDAUTH')) {
				return false;
			}

			throw new NpmError('Failed to run `npm whoami`', { cause: error });
		}
	}

	async collaborators(): Promise<Record<string, string>> {
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

	async hasPermission(): Promise<boolean> {
		const userName = await this.userName();

		const collaborators = await this.collaborators();

		return !!collaborators[userName]?.includes('write');
	}

	async distTags(): Promise<string[]> {
		try {
			return Object.keys(
				JSON.parse(
					await this.npm(['view', this.packageName, 'dist-tags', '--json']),
				),
			);
		} catch (error) {
			throw new NpmError(
				`Failed to run \`npm view ${this.packageName} dist-tags --json\``,
				{ cause: error },
			);
		}
	}

	async version(): Promise<string> {
		try {
			return this.npm(['--version']);
		} catch (error) {
			throw new NpmError('Failed to run `npm --version`', { cause: error });
		}
	}

	async ping(): Promise<boolean> {
		try {
			await exec('npm', ['ping'], { throwOnError: true });

			return true;
		} catch (error) {
			throw new NpmError('Failed to run `npm ping`', { cause: error });
		}
	}

	async publishProvenance(): Promise<boolean> {
		try {
			try {
				await this.npm(['publish', '--provenance', '--access', 'public']);
			} catch (error) {
				if (`${error}`.includes('EOTP')) {
					return false;
				}
			}

			return true;
		} catch (error) {
			throw new NpmError(
				'Failed to run `npm publish --provenance --access public`',
				{
					cause: error,
				},
			);
		}
	}

	async publish(otp?: string): Promise<boolean> {
		const args = otp ? ['publish', '--otp', otp] : ['publish'];

		try {
			try {
				await this.npm(args);
			} catch (error) {
				if (`${error}`.includes('EOTP')) {
					return false;
				}
			}

			return true;
		} catch (error) {
			throw new NpmError(`Failed to run \`npm ${args.join(' ')}\``, {
				cause: error,
			});
		}
	}

	async isPackageNameAvaliable(): Promise<boolean> {
		return isValidPackageName(this.packageName);
	}
}

export async function npmRegistry(): Promise<NpmRegistry> {
	const packageJson = await getPackageJson();

	return new NpmRegistry(packageJson.name);
}
