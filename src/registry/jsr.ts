import { exec } from 'tinyexec';
import { AbstractError } from '../error.js';
import { getJsrJson } from '../utils/package.js';
import { Registry } from './registry.js';

class JsrError extends AbstractError {
	name = 'jsr Error';
}

export class JsrRegisry extends Registry {
	packageName: string;
	registry = 'https://jsr.io';

	constructor(packageName?: string, registry?: string) {
		const jsrPackageName = packageName ?? getJsrJson()?.name;

		console.log(getJsrJson());

		super(jsrPackageName, registry);

		this.packageName = jsrPackageName;
	}

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

	async hasToken() {}

	async hasPermission() {
		return true;
	}

	async isPackageNameAvaliable() {
		return true;
	}
}
