import semver from 'semver';
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
			return (await this.git(['describe', '--tags', '--abbrev=0'])).trim();
		} catch {
			return null;
		}
	}

	async tags() {
		try {
			return (await this.git(['tag', '-l']))
				.trim()
				.split('\n')
				.map((v) => v.slice(1))
				.sort(semver.compareIdentifiers);
		} catch (error) {
			throw new GitError('Failed to run `git config --get user.name`', {
				cause: error,
			});
		}
	}

	async previousTag(tag: string) {
		try {
			const tags = await this.tags();

			return tags.at(tags.findIndex((t) => t === tag) - 1);
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
				'--format=%H %s',
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

	async stage(file: string) {
		try {
			await this.git(['add', file]);

			return true;
		} catch (error) {
			throw new GitError(`Failed to run \`git add ${file}\``, {
				cause: error,
			});
		}
	}

	async reset(rev?: string, option?: string) {
		const args = ['reset', rev, option].filter((v) => v) as string[];

		try {
			await this.git(args);

			return true;
		} catch (error) {
			throw new GitError(`Failed to run \`git ${args.join(' ')}\``, {
				cause: error,
			});
		}
	}

	async latestCommit() {
		try {
			return (await this.git(['rev-parse', 'HEAD'])).trim();
		} catch (error) {
			throw new GitError('Failed to run `git rev-parse HEAD`', {
				cause: error,
			});
		}
	}

	async firstCommit() {
		try {
			return (await this.git(['rev-list', '--max-parents=0', 'HEAD'])).trim();
		} catch (error) {
			throw new GitError('Failed to run `git rev-list --max-parents=0 HEAD`', {
				cause: error,
			});
		}
	}

	async commit(message: string) {
		try {
			await this.git(['commit', '-m', message]);

			return await this.latestCommit();
		} catch (error) {
			throw new GitError(`Failed to run \`git commit -m ${message}\``, {
				cause: error,
			});
		}
	}

	async repository() {
		try {
			return (await this.git(['remote', 'get-url', 'origin'])).trim();
		} catch (error) {
			throw new GitError('Failed to run `git remote get-url origin`', {
				cause: error,
			});
		}
	}

	async createTag(tag: string, commitRev?: string) {
		const args = ['tag', tag, commitRev].filter((v) => v) as string[];

		try {
			await this.git(args);

			return true;
		} catch (error) {
			throw new GitError(`Failed to run \`git ${args.join(' ')}\``, {
				cause: error,
			});
		}
	}

	async push(options?: string) {
		const args = ['push', options].filter((v) => v) as string[];

		try {
			const { stderr } = await exec('git', args, { throwOnError: true });

			if (`${stderr}`.includes('GH006')) {
				return false;
			}

			return true;
		} catch (error) {
			if (`${error}`.includes('GH006')) {
				return false;
			}

			throw new GitError(`Failed to run \`git ${args.join(' ')}\``, {
				cause: error,
			});
		}
	}
}
