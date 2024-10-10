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

	async userName() {
		try {
			return (await this.git(['config', '--get', 'user.name'])).trim();
		} catch (error) {
			throw new GitError('Failed to run `git config --get user.name`', {
				cause: error,
			});
		}
	}

	async latestTag() {
		try {
			return await this.git(['describe', '--tags', '--abbrev=0']);
		} catch {
			return null;
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

	async fetch() {
		try {
			await this.git(['fetch']);

			return true;
		} catch (error) {
			throw new GitError('Failed to run `git fetch`', {
				cause: error,
			});
		}
	}

	async pull() {
		try {
			await this.git(['pull']);

			return true;
		} catch (error) {
			throw new GitError('Failed to run `git pull`', {
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

	async version() {
		try {
			return (await this.git(['--version'])).trim().match(/\d+\.\d+\.\d+/)?.[0];
		} catch (error) {
			throw new GitError('Failed to run `git --version`', {
				cause: error,
			});
		}
	}

	async branch() {
		try {
			return (await this.git(['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
		} catch (error) {
			throw new GitError('Failed to run `git rev-parse --abbrev-ref HEAD`', {
				cause: error,
			});
		}
	}

	async switch(branch: string) {
		try {
			await this.git(['switch', branch]);

			return true;
		} catch (error) {
			throw new GitError(`Failed to run \`git switch ${branch}\``, {
				cause: error,
			});
		}
	}

	async checkTagExist(tag: string) {
		try {
			return (
				(
					await this.git(['rev-parse', '-q', '--verify', `refs/tags/${tag}`])
				).trim() !== ''
			);
		} catch (error) {
			throw new GitError(
				`Failed to run \`git rev-parse -q --verify refs/tags/${tag}\``,
				{
					cause: error,
				},
			);
		}
	}

	async deleteTag(tag: string) {
		try {
			await this.git(['tag', '--delete', tag]);

			return true;
		} catch (error) {
			throw new GitError(`Failed to run \`git tag --delete ${tag}\``, {
				cause: error,
			});
		}
	}

	async stageAll() {
		try {
			await this.git(['add', '.']);

			return true;
		} catch (error) {
			throw new GitError('Failed to run `git add .`', {
				cause: error,
			});
		}
	}

	async stash() {
		try {
			await this.git(['stash']);

			return true;
		} catch (error) {
			throw new GitError('Failed to run `git stash`', {
				cause: error,
			});
		}
	}

	async popStash() {
		try {
			await this.git(['stash', 'pop']);

			return true;
		} catch (error) {
			throw new GitError('Failed to run `git stash pop`', {
				cause: error,
			});
		}
	}
}
