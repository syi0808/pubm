import { exec } from 'tinyexec';
import { AbstractError } from '../error.js';
import { getJsrJson } from '../utils/package.js';
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
	api = getApiEndpoint(this.registry);
	token?: string;

	async jsr(args: string[]) {
		const { stdout, stderr } = await exec('jsr', args);

		if (stderr) throw stderr;

		return stdout;
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
			const response = await fetch(`${this.api}/user`, {
				headers: { Authorization: `Bearer ${this.token}` },
			});

			if (response.status === 401) return null;

			return await response.json();
		} catch (error) {
			throw new JsrError(`Failed to fetch \`${this.api}/user\``, {
				cause: error,
			});
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
