import { exec } from 'tinyexec';
import { AbstractError } from '../error.js';
import { Registry } from './registry.js';

class JsrError extends AbstractError {
	name = 'jsr Error';
}

export class JsrRegisry extends Registry {
	registry = 'https://jsr.io';

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
		return '';
	}

	async isPublished() {
		return false;
	}

	async hasToken() {}

	async hasPermission() {
		return true;
	}

	async isPackageNameAvaliable() {
		return true;
	}
}
