import { exec } from 'tinyexec';
import { Registry } from './registry.js';

export class JsrRegisry extends Registry {
	regitry = 'https://jsr.io';

	async jsr(args: string[]) {
		const { stdout, stderr } = await exec('jsr', args);

		if (stderr) throw stderr;

		return stdout;
	}

	async distTags() {
		return [];
	}

	async ping() {
		return true;
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

	async hasPermission() {
		return true;
	}

	async isPackageNameAvaliable() {
		return true;
	}
}
