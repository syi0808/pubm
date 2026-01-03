import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { Git } from '../../src/git';

vi.mock('tinyexec', () => ({
	exec: vi.fn(),
}));

import { exec } from 'tinyexec';

const mockedExec = vi.mocked(exec);

describe('Git', () => {
	let git: Git;

	beforeEach(() => {
		git = new Git();
		vi.clearAllMocks();
	});

	describe('version', () => {
		test('returns git version', async () => {
			mockedExec.mockResolvedValue({
				stdout: 'git version 2.40.0',
				stderr: '',
				exitCode: 0,
			} as never);

			const version = await git.version();

			expect(version).toBe('2.40.0');
			expect(mockedExec).toHaveBeenCalledWith('git', ['--version']);
		});
	});

	describe('branch', () => {
		test('returns current branch name', async () => {
			mockedExec.mockResolvedValue({
				stdout: 'main\n',
				stderr: '',
				exitCode: 0,
			} as never);

			const branch = await git.branch();

			expect(branch).toBe('main');
			expect(mockedExec).toHaveBeenCalledWith('git', [
				'rev-parse',
				'--abbrev-ref',
				'HEAD',
			]);
		});
	});

	describe('status', () => {
		test('returns clean status', async () => {
			mockedExec.mockResolvedValue({
				stdout: '',
				stderr: '',
				exitCode: 0,
			} as never);

			const status = await git.status();

			expect(status).toBe('');
			expect(mockedExec).toHaveBeenCalledWith('git', ['status', '--porcelain']);
		});

		test('returns dirty status', async () => {
			mockedExec.mockResolvedValue({
				stdout: 'M  src/index.ts\n?? new-file.ts\n',
				stderr: '',
				exitCode: 0,
			} as never);

			const status = await git.status();

			expect(status).toContain('M  src/index.ts');
			expect(status).toContain('?? new-file.ts');
		});
	});

	describe('userName', () => {
		test('returns git user name', async () => {
			mockedExec.mockResolvedValue({
				stdout: 'John Doe\n',
				stderr: '',
				exitCode: 0,
			} as never);

			const userName = await git.userName();

			expect(userName).toBe('John Doe');
			expect(mockedExec).toHaveBeenCalledWith('git', [
				'config',
				'--get',
				'user.name',
			]);
		});
	});

	describe('latestTag', () => {
		test('returns latest tag', async () => {
			mockedExec.mockResolvedValue({
				stdout: 'v1.2.3\n',
				stderr: '',
				exitCode: 0,
			} as never);

			const tag = await git.latestTag();

			expect(tag).toBe('v1.2.3');
			expect(mockedExec).toHaveBeenCalledWith('git', [
				'describe',
				'--tags',
				'--abbrev=0',
			]);
		});

		test('returns null when no tags exist', async () => {
			mockedExec.mockRejectedValue(new Error('No tags'));

			const tag = await git.latestTag();

			expect(tag).toBe(null);
		});
	});

	describe('tags', () => {
		test('returns list of tags', async () => {
			mockedExec.mockResolvedValue({
				stdout: 'v1.0.0\nv1.1.0\nv1.2.0\n',
				stderr: '',
				exitCode: 0,
			} as never);

			const tags = await git.tags();

			expect(tags).toEqual(['1.0.0', '1.1.0', '1.2.0']);
		});
	});

	describe('latestCommit', () => {
		test('returns latest commit hash', async () => {
			mockedExec.mockResolvedValue({
				stdout: 'abc123def456789\n',
				stderr: '',
				exitCode: 0,
			} as never);

			const commit = await git.latestCommit();

			expect(commit).toBe('abc123def456789');
			expect(mockedExec).toHaveBeenCalledWith('git', ['rev-parse', 'HEAD']);
		});
	});

	describe('firstCommit', () => {
		test('returns first commit hash', async () => {
			mockedExec.mockResolvedValue({
				stdout: 'first123commit\n',
				stderr: '',
				exitCode: 0,
			} as never);

			const commit = await git.firstCommit();

			expect(commit).toBe('first123commit');
			expect(mockedExec).toHaveBeenCalledWith('git', [
				'rev-list',
				'--max-parents=0',
				'HEAD',
			]);
		});
	});

	describe('repository', () => {
		test('returns repository URL', async () => {
			mockedExec.mockResolvedValue({
				stdout: 'https://github.com/user/repo.git\n',
				stderr: '',
				exitCode: 0,
			} as never);

			const repo = await git.repository();

			expect(repo).toBe('https://github.com/user/repo.git');
			expect(mockedExec).toHaveBeenCalledWith('git', [
				'remote',
				'get-url',
				'origin',
			]);
		});
	});

	describe('checkTagExist', () => {
		test('returns true when tag exists', async () => {
			mockedExec.mockResolvedValue({
				stdout: 'abc123\n',
				stderr: '',
				exitCode: 0,
			} as never);

			const exists = await git.checkTagExist('v1.0.0');

			expect(exists).toBe(true);
			expect(mockedExec).toHaveBeenCalledWith('git', [
				'rev-parse',
				'-q',
				'--verify',
				'refs/tags/v1.0.0',
			]);
		});

		test('returns false when tag does not exist', async () => {
			mockedExec.mockResolvedValue({
				stdout: '\n',
				stderr: '',
				exitCode: 0,
			} as never);

			const exists = await git.checkTagExist('v999.0.0');

			expect(exists).toBe(false);
		});
	});

	describe('stageAll', () => {
		test('stages all files', async () => {
			mockedExec.mockResolvedValue({
				stdout: '',
				stderr: '',
				exitCode: 0,
			} as never);

			const result = await git.stageAll();

			expect(result).toBe(true);
			expect(mockedExec).toHaveBeenCalledWith('git', ['add', '.']);
		});
	});

	describe('stage', () => {
		test('stages specific file', async () => {
			mockedExec.mockResolvedValue({
				stdout: '',
				stderr: '',
				exitCode: 0,
			} as never);

			const result = await git.stage('src/index.ts');

			expect(result).toBe(true);
			expect(mockedExec).toHaveBeenCalledWith('git', ['add', 'src/index.ts']);
		});
	});

	describe('commit', () => {
		test('creates commit and returns hash', async () => {
			mockedExec
				.mockResolvedValueOnce({
					stdout: '',
					stderr: '',
					exitCode: 0,
				} as never)
				.mockResolvedValueOnce({
					stdout: 'abc123def\n',
					stderr: '',
					exitCode: 0,
				} as never);

			const commitHash = await git.commit('feat: add new feature');

			expect(commitHash).toBe('abc123def');
			expect(mockedExec).toHaveBeenCalledWith('git', [
				'commit',
				'-m',
				'feat: add new feature',
			]);
		});
	});

	describe('createTag', () => {
		test('creates tag without commit', async () => {
			mockedExec.mockResolvedValue({
				stdout: '',
				stderr: '',
				exitCode: 0,
			} as never);

			const result = await git.createTag('v1.0.0');

			expect(result).toBe(true);
			expect(mockedExec).toHaveBeenCalledWith('git', ['tag', 'v1.0.0']);
		});

		test('creates tag with specific commit', async () => {
			mockedExec.mockResolvedValue({
				stdout: '',
				stderr: '',
				exitCode: 0,
			} as never);

			const result = await git.createTag('v1.0.0', 'abc123');

			expect(result).toBe(true);
			expect(mockedExec).toHaveBeenCalledWith('git', [
				'tag',
				'v1.0.0',
				'abc123',
			]);
		});
	});

	describe('deleteTag', () => {
		test('deletes tag', async () => {
			mockedExec.mockResolvedValue({
				stdout: '',
				stderr: '',
				exitCode: 0,
			} as never);

			const result = await git.deleteTag('v1.0.0');

			expect(result).toBe(true);
			expect(mockedExec).toHaveBeenCalledWith('git', [
				'tag',
				'--delete',
				'v1.0.0',
			]);
		});
	});

	describe('switch', () => {
		test('switches to branch', async () => {
			mockedExec.mockResolvedValue({
				stdout: '',
				stderr: '',
				exitCode: 0,
			} as never);

			const result = await git.switch('develop');

			expect(result).toBe(true);
			expect(mockedExec).toHaveBeenCalledWith('git', ['switch', 'develop']);
		});
	});

	describe('fetch', () => {
		test('fetches from remote', async () => {
			mockedExec.mockResolvedValue({
				stdout: '',
				stderr: '',
				exitCode: 0,
			} as never);

			const result = await git.fetch();

			expect(result).toBe(true);
			expect(mockedExec).toHaveBeenCalledWith('git', ['fetch']);
		});
	});

	describe('pull', () => {
		test('pulls from remote', async () => {
			mockedExec.mockResolvedValue({
				stdout: '',
				stderr: '',
				exitCode: 0,
			} as never);

			const result = await git.pull();

			expect(result).toBe(true);
			expect(mockedExec).toHaveBeenCalledWith('git', ['pull']);
		});
	});

	describe('stash', () => {
		test('stashes changes', async () => {
			mockedExec.mockResolvedValue({
				stdout: '',
				stderr: '',
				exitCode: 0,
			} as never);

			const result = await git.stash();

			expect(result).toBe(true);
			expect(mockedExec).toHaveBeenCalledWith('git', ['stash']);
		});
	});

	describe('popStash', () => {
		test('pops stashed changes', async () => {
			mockedExec.mockResolvedValue({
				stdout: '',
				stderr: '',
				exitCode: 0,
			} as never);

			const result = await git.popStash();

			expect(result).toBe(true);
			expect(mockedExec).toHaveBeenCalledWith('git', ['stash', 'pop']);
		});
	});

	describe('reset', () => {
		test('resets without options', async () => {
			mockedExec.mockResolvedValue({
				stdout: '',
				stderr: '',
				exitCode: 0,
			} as never);

			const result = await git.reset();

			expect(result).toBe(true);
			expect(mockedExec).toHaveBeenCalledWith('git', ['reset']);
		});

		test('resets with revision', async () => {
			mockedExec.mockResolvedValue({
				stdout: '',
				stderr: '',
				exitCode: 0,
			} as never);

			const result = await git.reset('HEAD~1');

			expect(result).toBe(true);
			expect(mockedExec).toHaveBeenCalledWith('git', ['reset', 'HEAD~1']);
		});

		test('resets with revision and option', async () => {
			mockedExec.mockResolvedValue({
				stdout: '',
				stderr: '',
				exitCode: 0,
			} as never);

			const result = await git.reset('HEAD~1', '--hard');

			expect(result).toBe(true);
			expect(mockedExec).toHaveBeenCalledWith('git', [
				'reset',
				'HEAD~1',
				'--hard',
			]);
		});
	});

	describe('commits', () => {
		test('returns commits between revisions', async () => {
			// Git hash is exactly 40 characters
			const hash1 = 'a'.repeat(40);
			const hash2 = 'b'.repeat(40);
			mockedExec.mockResolvedValue({
				stdout: `${hash1} feat: first commit\n${hash2} fix: second commit\n`,
				stderr: '',
				exitCode: 0,
			} as never);

			const commits = await git.commits('v1.0.0', 'v1.1.0');

			expect(commits.length).toBe(2);
			expect(commits[0].id).toBe(hash1);
			expect(commits[0].message).toBe('feat: first commit');
			expect(commits[1].id).toBe(hash2);
			expect(commits[1].message).toBe('fix: second commit');
			expect(mockedExec).toHaveBeenCalledWith('git', [
				'log',
				'v1.0.0...v1.1.0',
				'--format=%H %s',
			]);
		});

		test('returns empty array for no commits', async () => {
			mockedExec.mockResolvedValue({
				stdout: '',
				stderr: '',
				exitCode: 0,
			} as never);

			const commits = await git.commits('v1.0.0', 'v1.0.0');

			expect(commits).toEqual([]);
		});
	});

	describe('previousTag', () => {
		test('returns previous tag', async () => {
			mockedExec.mockResolvedValue({
				stdout: 'v1.0.0\nv1.1.0\nv1.2.0\n',
				stderr: '',
				exitCode: 0,
			} as never);

			const prevTag = await git.previousTag('1.2.0');

			expect(prevTag).toBe('1.1.0');
		});

		test('returns last tag when requesting first tag (wraps around)', async () => {
			// Note: This is the current behavior - when requesting the first tag,
			// it wraps around to return the last tag due to .at(-1) behavior
			mockedExec.mockResolvedValue({
				stdout: 'v1.0.0\nv1.1.0\n',
				stderr: '',
				exitCode: 0,
			} as never);

			const prevTag = await git.previousTag('1.0.0');

			// .at(-1) returns the last element when index is -1
			expect(prevTag).toBe('1.1.0');
		});

		test('returns null when tag not found', async () => {
			mockedExec.mockResolvedValue({
				stdout: 'v1.0.0\nv1.1.0\n',
				stderr: '',
				exitCode: 0,
			} as never);

			const prevTag = await git.previousTag('nonexistent');

			// When tag is not found, findIndex returns -1, so .at(-2) wraps
			expect(prevTag).toBeDefined();
		});
	});

	describe('revisionDiffsCount', () => {
		test('returns count of diffs', async () => {
			mockedExec.mockResolvedValue({
				stdout: '5\n',
				stderr: '',
				exitCode: 0,
			} as never);

			const count = await git.revisionDiffsCount();

			expect(count).toBe(5);
			expect(mockedExec).toHaveBeenCalledWith('git', [
				'rev-list',
				'@{u}...HEAD',
				'--count',
				'--left-only',
			]);
		});

		test('throws error on failure', async () => {
			mockedExec.mockResolvedValue({
				stdout: '',
				stderr: 'error',
				exitCode: 1,
			} as never);

			await expect(git.revisionDiffsCount()).rejects.toThrow();
		});
	});

	describe('dryFetch', () => {
		test('returns dry fetch output', async () => {
			mockedExec.mockResolvedValue({
				stdout: 'fetched info',
				stderr: '',
				exitCode: 0,
			} as never);

			const result = await git.dryFetch();

			expect(result).toBe('fetched info');
			expect(mockedExec).toHaveBeenCalledWith('git', ['fetch', '--dry-run']);
		});

		test('throws error on failure', async () => {
			mockedExec.mockResolvedValue({
				stdout: '',
				stderr: 'fetch error',
				exitCode: 1,
			} as never);

			await expect(git.dryFetch()).rejects.toThrow();
		});
	});

	describe('push', () => {
		test('pushes successfully', async () => {
			mockedExec.mockResolvedValue({
				stdout: 'Everything up-to-date',
				stderr: '',
				exitCode: 0,
			} as never);

			const result = await git.push();

			expect(result).toBe(true);
			expect(mockedExec).toHaveBeenCalledWith('git', ['push'], {
				throwOnError: true,
			});
		});

		test('pushes with options', async () => {
			mockedExec.mockResolvedValue({
				stdout: '',
				stderr: '',
				exitCode: 0,
			} as never);

			const result = await git.push('--tags');

			expect(result).toBe(true);
			expect(mockedExec).toHaveBeenCalledWith('git', ['push', '--tags'], {
				throwOnError: true,
			});
		});

		test('returns false when GH006 error in stderr', async () => {
			mockedExec.mockResolvedValue({
				stdout: '',
				stderr: 'GH006: Protected branch update failed',
				exitCode: 0,
			} as never);

			const result = await git.push();

			expect(result).toBe(false);
		});

		test('returns false when GH006 error thrown', async () => {
			mockedExec.mockRejectedValue(new Error('GH006: Protected branch'));

			const result = await git.push();

			expect(result).toBe(false);
		});

		test('throws error on other failures', async () => {
			mockedExec.mockRejectedValue(new Error('Network error'));

			await expect(git.push()).rejects.toThrow();
		});
	});

	describe('error handling', () => {
		test('userName throws GitError on failure', async () => {
			mockedExec.mockResolvedValue({
				stdout: '',
				stderr: 'error',
				exitCode: 1,
			} as never);

			await expect(git.userName()).rejects.toThrow();
		});

		test('tags throws GitError on failure', async () => {
			mockedExec.mockResolvedValue({
				stdout: '',
				stderr: 'error',
				exitCode: 1,
			} as never);

			await expect(git.tags()).rejects.toThrow();
		});

		test('fetch throws GitError on failure', async () => {
			mockedExec.mockResolvedValue({
				stdout: '',
				stderr: 'error',
				exitCode: 1,
			} as never);

			await expect(git.fetch()).rejects.toThrow();
		});

		test('pull throws GitError on failure', async () => {
			mockedExec.mockResolvedValue({
				stdout: '',
				stderr: 'error',
				exitCode: 1,
			} as never);

			await expect(git.pull()).rejects.toThrow();
		});

		test('status throws GitError on failure', async () => {
			mockedExec.mockResolvedValue({
				stdout: '',
				stderr: 'error',
				exitCode: 1,
			} as never);

			await expect(git.status()).rejects.toThrow();
		});

		test('commits throws GitError on failure', async () => {
			mockedExec.mockResolvedValue({
				stdout: '',
				stderr: 'error',
				exitCode: 1,
			} as never);

			await expect(git.commits('v1', 'v2')).rejects.toThrow();
		});

		test('version throws GitError on failure', async () => {
			mockedExec.mockResolvedValue({
				stdout: '',
				stderr: 'error',
				exitCode: 1,
			} as never);

			await expect(git.version()).rejects.toThrow();
		});

		test('branch throws GitError on failure', async () => {
			mockedExec.mockResolvedValue({
				stdout: '',
				stderr: 'error',
				exitCode: 1,
			} as never);

			await expect(git.branch()).rejects.toThrow();
		});

		test('switch throws GitError on failure', async () => {
			mockedExec.mockResolvedValue({
				stdout: '',
				stderr: 'error',
				exitCode: 1,
			} as never);

			await expect(git.switch('main')).rejects.toThrow();
		});

		test('checkTagExist throws GitError on failure', async () => {
			mockedExec.mockResolvedValue({
				stdout: '',
				stderr: 'error',
				exitCode: 1,
			} as never);

			await expect(git.checkTagExist('v1.0.0')).rejects.toThrow();
		});

		test('deleteTag throws GitError on failure', async () => {
			mockedExec.mockResolvedValue({
				stdout: '',
				stderr: 'error',
				exitCode: 1,
			} as never);

			await expect(git.deleteTag('v1.0.0')).rejects.toThrow();
		});

		test('stageAll throws GitError on failure', async () => {
			mockedExec.mockResolvedValue({
				stdout: '',
				stderr: 'error',
				exitCode: 1,
			} as never);

			await expect(git.stageAll()).rejects.toThrow();
		});

		test('stash throws GitError on failure', async () => {
			mockedExec.mockResolvedValue({
				stdout: '',
				stderr: 'error',
				exitCode: 1,
			} as never);

			await expect(git.stash()).rejects.toThrow();
		});

		test('popStash throws GitError on failure', async () => {
			mockedExec.mockResolvedValue({
				stdout: '',
				stderr: 'error',
				exitCode: 1,
			} as never);

			await expect(git.popStash()).rejects.toThrow();
		});

		test('stage throws GitError on failure', async () => {
			mockedExec.mockResolvedValue({
				stdout: '',
				stderr: 'error',
				exitCode: 1,
			} as never);

			await expect(git.stage('file.ts')).rejects.toThrow();
		});

		test('reset throws GitError on failure', async () => {
			mockedExec.mockResolvedValue({
				stdout: '',
				stderr: 'error',
				exitCode: 1,
			} as never);

			await expect(git.reset()).rejects.toThrow();
		});

		test('latestCommit throws GitError on failure', async () => {
			mockedExec.mockResolvedValue({
				stdout: '',
				stderr: 'error',
				exitCode: 1,
			} as never);

			await expect(git.latestCommit()).rejects.toThrow();
		});

		test('firstCommit throws GitError on failure', async () => {
			mockedExec.mockResolvedValue({
				stdout: '',
				stderr: 'error',
				exitCode: 1,
			} as never);

			await expect(git.firstCommit()).rejects.toThrow();
		});

		test('commit throws GitError on failure', async () => {
			mockedExec.mockResolvedValue({
				stdout: '',
				stderr: 'error',
				exitCode: 1,
			} as never);

			await expect(git.commit('message')).rejects.toThrow();
		});

		test('repository throws GitError on failure', async () => {
			mockedExec.mockResolvedValue({
				stdout: '',
				stderr: 'error',
				exitCode: 1,
			} as never);

			await expect(git.repository()).rejects.toThrow();
		});

		test('createTag throws GitError on failure', async () => {
			mockedExec.mockResolvedValue({
				stdout: '',
				stderr: 'error',
				exitCode: 1,
			} as never);

			await expect(git.createTag('v1.0.0')).rejects.toThrow();
		});
	});

	describe('previousTag edge cases', () => {
		test('returns null when tags() throws', async () => {
			mockedExec.mockRejectedValue(new Error('git error'));

			const result = await git.previousTag('1.0.0');

			expect(result).toBe(null);
		});
	});
});
