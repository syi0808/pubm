import { exec } from 'tinyexec';
import { AbstractError } from './error.js';

class GitError extends AbstractError {
	name = 'Git Error';
}

export class Git {
	async git(args: string[]) {
		const { stdout, stderr } = await exec('git', args);

		if (stderr) throw stderr;

		return stdout;
	}

	async latestTag() {
		try {
			return await this.git(['describe', '--tags', '--abbrev=0']);
		} catch (error) {
			if (`${error}`.includes('No names found')) {
				return null;
			}

			throw new GitError('Failed to retrieve the latest tag on Git.', {
				cause: error,
			});
		}
	}

	async dryFetch() {
		try {
			return await this.git(['fetch', '--dry-run']);
		} catch (error) {
			throw new GitError('Failed to run `git fetch --dry-run`', {
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
			throw new GitError(
				'Failed to run `git rev-list @{u}...HEAD --count --left-only`',
				{ cause: error },
			);
		}
	}

	async status() {
		try {
			return (await this.git(['status', '--porcelain'])).trim();
		} catch (error) {
			throw new GitError('Failed to run `git status --porcelain`', {
				cause: error,
			});
		}
	}

	async commits(leftRev: string, rightRev: string) {
		try {
			const logs = await this.git([
				'log',
				`${leftRev}...${rightRev}`,
				`--format='%H %s'`,
			]);

			return logs
				.split('\n')
				.flatMap((log) =>
					log ? [{ id: log.slice(0, 40), message: log.slice(41) }] : [],
				);
		} catch (error) {
			throw new GitError(
				`Failed to run \`git log ${leftRev}...${rightRev} --format='%H %s'\``,
				{
					cause: error,
				},
			);
		}
	}
}
