import type { ListrRendererFactory, ListrTaskWrapper } from 'listr2';
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

	private async dryFetch() {
		try {
			return await this.git(['fetch', '--dry-run']);
		} catch (error) {
			throw new this.E('Failed to run `git fetch --dry-run`', {
				cause: error,
			});
		}
	}

	private async revisionDiffsCount() {
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

	async verifyRemoteHistory<
		T extends ListrTaskWrapper<
			unknown,
			ListrRendererFactory,
			ListrRendererFactory
		>,
	>(task: T) {
		task.output = 'Checking `git fetch`';

		if ((await this.dryFetch()).trim()) {
			throw new this.E(
				'local history is outdated. you should run `git fetch`.',
			);
		}

		task.output = 'Checking `git pull`';
		if (await this.revisionDiffsCount()) {
			throw new this.E('local history is outdated. you should run `git pull`.');
		}
	}
}
