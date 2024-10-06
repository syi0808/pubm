import path from 'node:path';
import { exec } from 'tinyexec';
import { filesIgnoreWithGit } from './utils/ignore';
import { validateEngineVersion } from './utils/engine-version.js';

export class Git {
	async git(args: string[]) {
		return (await exec('git', args, { throwOnError: true })).stdout;
	}

	latestTag() {
		return this.git(['describe', '--tags', '--abbrev=0']);
	}
}

export async function latestTag() {
	return '';
}

export async function root() {
	const { stdout } = await exec('git', ['rev-parse', '--show-toplevel']);
	return stdout;
}

export async function newFilesSinceLastRelease(root: string) {
	try {
		const { stdout } = await exec('git', [
			'diff',
			'--name-only',
			'--diff-filter=A',
			await latestTag(),
			'HEAD',
		]);

		if (stdout.trim().length === 0) {
			return [];
		}

		const result = stdout
			.trim()
			.split('\n')
			.map((row) => row.trim());
		return result;
	} catch {
		return filesIgnoreWithGit(root);
	}
}

export async function readFileFromLastRelease(file: string) {
	const rootPath = await root();
	const filePathFromRoot = path.relative(
		rootPath,
		path.resolve(rootPath, file),
	);
	const { stdout: oldFile } = await exec('git', [
		'show',
		`${await latestTag()}:${filePathFromRoot}`,
	]);
	return oldFile;
}

async function tagList() {
	const { stdout } = await exec('git', ['tag', '--sort=creatordate']);
	return stdout ? stdout.split('\n') : [];
}

async function firstCommit() {
	const { stdout } = await exec('git', ['rev-list', '--max-parents=0', 'HEAD']);
	return stdout;
}

export async function previousTagOrFirstCommit() {
	const tags = await tagList();

	if (tags.length === 0) {
		return;
	}

	if (tags.length === 1) {
		return firstCommit();
	}

	try {
		// Return the tag before the latest one.
		const latest = await latestTag();
		const index = tags.indexOf(latest);
		return tags[index - 1];
	} catch {
		// Fallback to the first commit.
		return firstCommit();
	}
}

export async function latestTagOrFirstCommit() {
	let latest: string;

	try {
		// In case a previous tag exists, we use it to compare the current repo status to.
		latest = await latestTag();
	} catch {
		// Otherwise, we fallback to using the first commit for comparison.
		latest = await firstCommit();
	}

	return latest;
}

export async function hasUpstream() {
	// https://github.com/sindresorhus/escape-string-regexp/blob/main/index.js
	const escapedCurrentBranch = (await getCurrentBranch())
		.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&')
		.replace(/-/g, '\\x2d');

	const { stdout } = await exec('git', [
		'status',
		'--short',
		'--branch',
		'--porcelain',
	]);

	return new RegExp(
		String.raw`^## ${escapedCurrentBranch}\.\.\..+\/${escapedCurrentBranch}`,
	).test(stdout);
}

export async function getCurrentBranch() {
	const { stdout } = await exec('git', ['symbolic-ref', '--short', 'HEAD']);

	return stdout;
}

export async function verifyCurrentBranchIsReleaseBranch(
	releaseBranch: string,
) {
	const currentBranch = await getCurrentBranch();

	if (currentBranch !== releaseBranch) {
		throw new Error(
			`Not on \`${releaseBranch}\` branch. Use --any-branch to publish anyway, or set a different release branch using --branch.`,
		);
	}

	return true;
}

export async function isHeadDetached() {
	try {
		// Command will fail with code 1 if the HEAD is detached.
		await exec('git', ['symbolic-ref', '--quiet', 'HEAD']);
		return false;
	} catch {
		return true;
	}
}

async function isWorkingTreeClean() {
	try {
		const { stdout: status } = await exec('git', ['status', '--porcelain']);

		if (status !== '') {
			return false;
		}

		return true;
	} catch {
		return false;
	}
}

export async function verifyWorkingTreeIsClean() {
	if (await isWorkingTreeClean()) {
		return true;
	}

	throw new Error('Unclean working tree. Commit or stash changes first.');
}

async function hasRemote() {
	try {
		await exec('git', ['rev-parse', '@{u}']);
	} catch {
		return false;
	}

	return true;
}

async function hasUnfetchedChangesFromRemote() {
	const { stdout: possibleNewChanges } = await exec('git', [
		'fetch',
		'--dry-run',
	]);

	// There are no unfetched changes if output is empty.
	return !possibleNewChanges || possibleNewChanges === '';
}

async function isRemoteHistoryClean() {
	const { stdout: history } = await exec('git', [
		'rev-list',
		'--count',
		'--left-only',
		'@{u}...HEAD',
	]);

	// Remote history is clean if there are 0 revisions.
	return history === '0';
}

export async function verifyRemoteHistoryIsClean() {
	if (!(await hasRemote())) {
		return;
	}

	if (!(await hasUnfetchedChangesFromRemote())) {
		throw new Error(
			'Remote history differs. Please run `git fetch` and pull changes.',
		);
	}

	if (!(await isRemoteHistoryClean())) {
		throw new Error('Remote history differs. Please pull changes.');
	}
}

export async function verifyRemoteIsValid() {
	try {
		const { stderr } = await exec('git', ['ls-remote', 'origin', 'HEAD']);

		if (stderr) throw stderr;
	} catch (error) {
		throw new Error(`${error}`.replace('fatal:', 'Git fatal error:'));
	}
}

export async function fetch() {
	await exec('git', ['fetch']);
}

async function hasLocalBranch(branch: string) {
	try {
		await exec('git', [
			'show-ref',
			'--verify',
			'--quiet',
			`refs/heads/${branch}`,
		]);
		return true;
	} catch {
		return false;
	}
}

export async function defaultBranch() {
	for (const branch of ['main', 'master', 'gh-pages']) {
		if (await hasLocalBranch(branch)) {
			return branch;
		}
	}

	throw new Error(
		'Could not infer the default Git branch. Please specify one with the --branch flag or with a np config.',
	);
}

async function tagExistsOnRemote(tagName: string) {
	try {
		const { stdout: revInfo, stderr } = await exec('git', [
			'rev-parse',
			'--quiet',
			'--verify',
			`refs/tags/${tagName}`,
		]);

		if (stderr) throw { stdout: revInfo, stderr };

		if (revInfo) {
			return true;
		}

		return false;
	} catch (error) {
		// Command fails with code 1 and no output if the tag does not exist, even though `--quiet` is provided
		// https://github.com/sindresorhus/np/pull/73#discussion_r72385685
		if (
			(error as { stdout: string }).stdout === '' &&
			(error as { stderr: string }).stderr === ''
		) {
			return false;
		}

		throw error;
	}
}

export async function verifyTagDoesNotExistOnRemote(tagName: string) {
	if (await tagExistsOnRemote(tagName)) {
		throw new Error(`Git tag \`${tagName}\` already exists.`);
	}
}

export async function commitLogFromRevision(revision: string) {
	const { stdout } = await exec('git', [
		'log',
		'--format=%s %h',
		`${revision}..HEAD`,
	]);
	return stdout;
}

const push = async (tagArgument = '--follow-tags') => {
	return await exec('git', ['push', tagArgument]);
};

export async function pushGraceful(remoteIsOnGitHub: string) {
	try {
		const { stderr } = await push();

		if (stderr) throw stderr;
	} catch (error) {
		if (remoteIsOnGitHub && error && `${error}`.includes('GH006')) {
			// Try to push tags only, when commits can't be pushed due to branch protection
			await push('--tags');
			return {
				pushed: 'tags',
				reason:
					'Branch protection: np can`t push the commits. Push them manually.',
			};
		}

		throw error;
	}
}

export async function deleteTag(tagName: string) {
	await exec('git', ['tag', '--delete', tagName]);
}

export async function removeLastCommit() {
	await exec('git', ['reset', '--hard', 'HEAD~1']);
}

async function gitVersion() {
	const { stdout } = await exec('git', ['version']);
	const match = /git version (?<version>\d+\.\d+\.\d+).*/.exec(stdout);

	return match?.groups?.version;
}

export async function verifyRecentGitVersion() {
	const installedVersion = await gitVersion();

	if (!installedVersion) return false;

	return await validateEngineVersion('git', installedVersion);
}
