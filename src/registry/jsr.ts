import { exec } from 'tinyexec';
import { AbstractError } from '../error.js';
import type { JsrApi } from '../types/jsr-api.js';
import { Db } from '../utils/db.js';
import {
	getScope,
	getScopeAndName,
	isValidPackageName,
} from '../utils/package-name.js';
import { getJsrJson, version } from '../utils/package.js';
import { Registry } from './registry.js';

class JsrError extends AbstractError {
	name = 'jsr Error';
}

function getApiEndpoint(registry: string) {
	const url = new URL(registry);

	url.host = `api.${url.host}`;

	return `${url}`;
}

export class JsrRegisry extends Registry {
	registry = 'https://jsr.io';
	client: JsrClient;

	constructor(packageName: string, registry?: string) {
		super(packageName, registry);

		this.client = new JsrClient(getApiEndpoint(this.registry));
	}

	protected async jsr(args: string[]) {
		const { stdout, stderr } = await exec('jsr', args);

		if (stderr) throw stderr;

		return stdout;
	}

	async isInstalled() {
		try {
			await this.jsr(['--help']);

			return true;
		} catch {
			return false;
		}
	}

	async distTags() {
		return [];
	}

	async ping() {
		try {
			const { stdout, stderr } = await exec('ping', [
				new URL(this.registry).hostname,
				'-c',
				'1',
			]);

			if (stderr) throw stderr;

			return stdout.includes('1 packets transmitted');
		} catch (error) {
			throw new JsrError(
				`Failed to run \`ping ${new URL(this.registry).hostname}\` -c 1`,
				{ cause: error },
			);
		}
	}

	async publish() {
		try {
			await exec(
				'jsr',
				['publish', '--allow-dirty', '--token', `${this.client.token}`],
				{
					throwOnError: true,
				},
			);

			return true;
		} catch (error) {
			throw new JsrError(
				'Failed to run `jsr publish --allow-dirty --token ***`',
				{
					cause: error,
				},
			);
		}
	}

	async version() {
		return await this.jsr(['--version']);
	}

	async isPublished() {
		try {
			const response = await fetch(`${this.registry}/${this.packageName}`);

			return response.status === 200;
		} catch (error) {
			throw new JsrError(
				`Failed to fetch \`${this.registry}/${this.packageName}\``,
				{ cause: error },
			);
		}
	}

	async hasPermission() {
		return (
			this.client.scopePermission(`${getScope(this.packageName)}`) !== null
		);
	}

	async isPackageNameAvaliable() {
		return isValidPackageName(this.packageName);
	}
}

export class JsrClient {
	constructor(
		public apiEndpoint: string,
		public token?: string,
	) {
		if (!this.token) {
			const token = new Db().get('jsr-token');

			if (token) this.token = token;
		}
	}

	protected async fetch(endpoint: string, init?: RequestInit) {
		const pubmVersion = await version({ cwd: import.meta.dirname });

		return fetch(new URL(endpoint, this.apiEndpoint), {
			...init,
			headers: {
				...init?.headers,
				Authorization: `Bearer ${this.token}`,
				'User-Agent': `pubm/${pubmVersion}; https://github.com/syi0808/pubm`,
			},
		});
	}

	async user() {
		try {
			const response = await this.fetch('/user');

			if (response.status === 401) return null;

			return (await response.json()) as JsrApi.Users.User;
		} catch (error) {
			throw new JsrError(`Failed to fetch \`${this.apiEndpoint}/user\``, {
				cause: error,
			});
		}
	}

	async scopePermission(scope: string) {
		try {
			const response = await this.fetch(`/user/member/${scope}`);

			if (response.status === 401) return null;

			return (await response.json()) as JsrApi.Users.Scopes.Permission;
		} catch (error) {
			throw new JsrError(
				`Failed to fetch \`${this.apiEndpoint}/user/member/${scope}\``,
				{
					cause: error,
				},
			);
		}
	}

	async scopes(): Promise<string[]> {
		try {
			const response = await this.fetch('/user/scopes');

			if (response.status === 401) return [];

			return ((await response.json()) as JsrApi.Users.Scopes).map(
				({ scope }) => scope,
			);
		} catch (error) {
			throw new JsrError(
				`Failed to fetch \`${this.apiEndpoint}/user/scopes\``,
				{
					cause: error,
				},
			);
		}
	}

	async package(packageName: string) {
		const [scope, name] = getScopeAndName(packageName);

		try {
			const response = await this.fetch(`/scopes/${scope}/packages/${name}`);

			return (await response.json()) as JsrApi.Scopes.Packages.Package;
		} catch (error) {
			throw new JsrError(
				`Failed to fetch \`${this.apiEndpoint}/user/scopes\``,
				{
					cause: error,
				},
			);
		}
	}

	async createScope(scope: string) {
		try {
			const response = await this.fetch('/scopes', {
				method: 'POST',
				body: JSON.stringify({ scope }),
			});

			return response.status === 200 || response.status === 201;
		} catch (error) {
			throw new JsrError(`Failed to fetch \`${this.apiEndpoint}/scopes\``, {
				cause: error,
			});
		}
	}

	async deleteScope(scope: string) {
		try {
			const response = await this.fetch(`/scopes/${scope}`, {
				method: 'DELETE',
			});

			return response.status === 200 || response.status === 204;
		} catch (error) {
			throw new JsrError(
				`Failed to fetch \`${this.apiEndpoint}/scopes/${scope}\``,
				{
					cause: error,
				},
			);
		}
	}

	async createPackage(packageName: string) {
		const [scope, name] = getScopeAndName(packageName);

		try {
			const response = await this.fetch(`/scopes/${scope}/packages`, {
				method: 'POST',
				body: JSON.stringify({ package: name }),
			});

			return response.status === 200 || response.status === 201;
		} catch (error) {
			throw new JsrError(
				`Failed to fetch \`${this.apiEndpoint}/scopes/${scope}/packages\``,
				{
					cause: error,
				},
			);
		}
	}

	async deletePackage(packageName: string) {
		const [scope, name] = getScopeAndName(packageName);

		try {
			const response = await this.fetch(`/scopes/${scope}/packages/${name}`, {
				method: 'DELETE',
			});

			return response.status === 200 || response.status === 204;
		} catch (error) {
			throw new JsrError(
				`Failed to fetch \`${this.apiEndpoint}/scopes/${scope}/packages/${name}\``,
				{
					cause: error,
				},
			);
		}
	}

	async searchPackage(query: string) {
		try {
			const response = await this.fetch(`/packages?query=${query}`);

			return (await response.json()) as JsrApi.Packages;
		} catch (error) {
			throw new JsrError(
				`Failed to fetch \`${this.apiEndpoint}/packages?query=${query}\``,
				{
					cause: error,
				},
			);
		}
	}
}

export async function jsrRegistry() {
	const jsrJson = await getJsrJson();

	return new JsrRegisry(jsrJson.name);
}
