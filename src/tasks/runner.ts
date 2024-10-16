import process from 'node:process';
import npmCli from '@npmcli/promise-spawn';
import { color, type Listr } from 'listr2';
import SemVer from 'semver';
import { isCI } from 'std-env';
import { exec } from 'tinyexec';
import { AbstractError, consoleError } from '../error.js';
import { Git } from '../git.js';
import type { ResolvedOptions } from '../types/options.js';
import { link } from '../utils/cli.js';
import { createListr } from '../utils/listr.js';
import { getPackageManager } from '../utils/package-manager.js';
import {
	getJsrJson,
	getPackageJson,
	replaceVersion,
} from '../utils/package.js';
import { addRollback, rollback } from '../utils/rollback.js';
import { jsrPublishTasks } from './jsr.js';
import { npmPublishTasks } from './npm.js';
import { prerequisitesCheckTask } from './prerequisites-check.js';
import { requiredConditionsCheckTask } from './required-conditions-check.js';

const { open } = npmCli;
const { prerelease } = SemVer;

export interface Ctx extends ResolvedOptions {
	promptEnabled: boolean;
	npmOnly: boolean;
	jsrOnly: boolean;
	cleanWorkingTree: boolean;
}

export async function run(options: ResolvedOptions): Promise<void> {
	const ctx = <Ctx>{
		...options,
		promptEnabled: !isCI && process.stdin.isTTY,
		npmOnly: options.registries.every((registry) => registry !== 'jsr'),
		jsrOnly: options.registries.every((registry) => registry === 'jsr'),
	};

	try {
		if (options.contents) process.chdir(options.contents);

		if (!options.publishOnly) {
			await prerequisitesCheckTask({
				skip: options.skipPrerequisitesCheck,
			}).run(ctx);

			await requiredConditionsCheckTask({
				skip: options.skipConditionsCheck,
			}).run(ctx);
		}

		await createListr<Ctx>(
			options.publishOnly
				? {
						title: 'Publishing',
						task: (ctx, parentTask): Listr<Ctx> =>
							parentTask.newListr(
								ctx.registries.map((registry) => {
									switch (registry) {
										case 'npm':
											return npmPublishTasks;
										case 'jsr':
											return jsrPublishTasks;
										default:
											return npmPublishTasks;
									}
								}),
								{ concurrent: true },
							),
					}
				: [
						{
							skip: options.skipTests,
							title: 'Running tests',
							task: async (ctx): Promise<void> => {
								const packageManager = await getPackageManager();

								const { stderr } = await exec(packageManager, [
									'run',
									ctx.testScript,
								]);

								if (stderr) {
									throw new AbstractError(
										`Failed to run \`${packageManager} run ${ctx.testScript}\``,
										{ cause: stderr },
									);
								}
							},
						},
						{
							skip: options.skipBuild,
							title: 'Building the project',
							task: async (ctx): Promise<void> => {
								const packageManager = await getPackageManager();

								try {
									await exec(packageManager, ['run', ctx.buildScript], {
										throwOnError: true,
									});
								} catch (error) {
									throw new AbstractError(
										`Failed to run \`${packageManager} run ${ctx.buildScript}\``,
										{ cause: error },
									);
								}
							},
						},
						{
							title: 'Bumping version',
							skip: (ctx) => !!ctx.preview,
							task: async (ctx, task): Promise<void> => {
								const git = new Git();
								let tagCreated = false;
								let commited = false;

								addRollback(async () => {
									if (tagCreated) {
										console.log('Deleting tag...');
										await git.deleteTag(`${await git.latestTag()}`);
									}

									if (commited) {
										console.log('Reset commits...');
										await git.reset();
										await git.stash();
										await git.reset('HEAD^', '--hard');
										await git.popStash();
									}
								}, ctx);

								await git.reset();
								const replaced = await replaceVersion(ctx.version);

								for (const replacedFile of replaced) {
									await git.stage(replacedFile);
								}

								const nextVersion = `v${ctx.version}`;
								const commit = await git.commit(nextVersion);

								commited = true;

								task.output = 'Creating tag...';
								await git.createTag(nextVersion, commit);

								tagCreated = true;
							},
						},
						{
							skip: (ctx) => options.skipPublish || !!ctx.preview,
							title: 'Publishing',
							task: (ctx, parentTask): Listr<Ctx> =>
								parentTask.newListr(
									ctx.registries.map((registry) => {
										switch (registry) {
											case 'npm':
												return npmPublishTasks;
											case 'jsr':
												return jsrPublishTasks;
											default:
												return npmPublishTasks;
										}
									}),
									{ concurrent: true },
								),
						},
						{
							title: 'Pushing tags to GitHub',
							skip: (ctx) => !!ctx.preview,
							task: async (_, task): Promise<void> => {
								const git = new Git();

								const result = await git.push('--follow-tags');

								if (!result) {
									task.title +=
										' (Only tags were pushed because the release branch is protected. Please push the branch manually.)';

									await git.push('--tags');
								}
							},
						},
						{
							skip: (ctx) => options.skipReleaseDraft || !!ctx.preview,
							title: 'Creating release draft on GitHub',
							task: async (ctx, task): Promise<void> => {
								const git = new Git();

								const repositoryUrl = await git.repository();

								const latestTag = `${await git.latestTag()}`;

								const lastRev =
									(await git.previousTag(latestTag)) ||
									(await git.firstCommit());

								const commits = (
									await git.commits(lastRev, `${latestTag}`)
								).slice(1);

								let body = commits
									.map(
										({ id, message }) =>
											`- ${message.replace('#', `${repositoryUrl}/issues/`)} ${repositoryUrl}/commit/${id}`,
									)
									.join('\n');

								body += `\n\n${repositoryUrl}/compare/${lastRev}...${latestTag}`;

								const releaseDraftUrl = new URL(
									`${repositoryUrl}/releases/new`,
								);

								releaseDraftUrl.searchParams.set('tag', `${latestTag}`);
								releaseDraftUrl.searchParams.set('body', body);
								releaseDraftUrl.searchParams.set(
									'prerelease',
									`${!!prerelease(ctx.version)}`,
								);

								const linkUrl = link('Link', releaseDraftUrl.toString());

								task.title += ` ${linkUrl}`;

								await open(releaseDraftUrl.toString());
							},
						},
					],
		).run(ctx);

		const npmPackageName = (await getPackageJson()).name;
		const jsrPackageName = (await getJsrJson()).name;

		console.log(
			`\n\n🚀 Successfully published ${color.bold(npmPackageName)} on ${color.green('npm')} and ${color.bold(jsrPackageName)} on ${color.yellow('jsr')} ${color.blueBright(`v${ctx.version}`)} 🚀\n`,
		);
	} catch (e: unknown) {
		consoleError(e as Error);

		await rollback();

		process.exit(1);
	}
}
