import { exec } from 'tinyexec';
import { AbstractError } from '../error.js';
import type { JsrApi } from '../types/jsr-api.js';
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
	protected api = getApiEndpoint(this.registry);
	token?: string;

	protected async jsr(args: string[]) {
		const { stdout, stderr } = await exec('jsr', args);

		if (stderr) throw stderr;

		return stdout;
	}

	protected async fetch(endpoint: string, init?: RequestInit) {
		const pubmVersion = await version({ cwd: import.meta.dirname });

		return fetch(new URL(endpoint, this.api), {
			...init,
			headers: {
				...init?.headers,
				Authorization: `Bearer ${this.token}`,
				'User-Agent': `pubm/${pubmVersion}; https://github.com/syi0808/pubm`,
			},
		});
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
		return true;
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

	async user() {
		try {
			const response = await this.fetch('/user');

			if (response.status === 401) return null;

			return (await response.json()) as JsrApi.Users.User;
		} catch (error) {
			throw new JsrError(`Failed to fetch \`${this.api}/user\``, {
				cause: error,
			});
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
			throw new JsrError(`Failed to fetch \`${this.api}/user/scopes\``, {
				cause: error,
			});
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
			throw new JsrError(`Failed to fetch \`${this.api}/scopes\``, {
				cause: error,
			});
		}
	}

	async searchPackage(query: string) {
		try {
			const response = await this.fetch(`/packages?query=${query}`);

			return (await response.json()) as JsrApi.Packages;
		} catch (error) {
			throw new JsrError(
				`Failed to fetch \`${this.api}/packages?query=${query}\``,
				{
					cause: error,
				},
			);
		}
	}

	async hasPermission() {
		return true;
	}

	async isPackageNameAvaliable() {
		return true;
	}
}

export async function jsrRegistry() {
	const jsrJson = await getJsrJson();

	return new JsrRegisry(jsrJson.name);
}
