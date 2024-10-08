import { exec } from 'tinyexec';
import type { AbstractError } from './error.js';

export class Git {
	constructor(protected E: typeof AbstractError = Error) {}

	async git(args: string[]) {
		return (await exec('git', args, { throwOnError: true })).stdout;
	}

	latestTag() {
		try {
			return this.git(['describe', '--tags', '--abbrev=0']);
		} catch {
			throw new Error('Failed to retrieve the latest tag on Git.');
		}
	}

	async dryFetch() {
		try {
			return await this.git(['fetch', '--dry-run']);
		} catch (error) {
			throw new this.E('Failed to run `git fetch --dry-run`', {
				cause: error,
			});
		}
	}

	async revisionDiffsCount() {
		try {
			return await Number.parseInt(
				await this.git(['rev-list', '@{u}...HEAD', '--count', '--left-only']),
			);
		} catch (error) {
			throw new this.E(
				'Failed to run `git rev-list @{u}...HEAD --count --left-only`',
				{ cause: error },
			);
		}
	}

	async status() {
		try {
			return (await this.git(['status', '--porcelain'])).trim();
		} catch (error) {
			throw new this.E('Failed to run `git status --porcelain`', {
				cause: error,
			});
		}
	}
}
