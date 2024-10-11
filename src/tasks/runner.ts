import npmCli from '@npmcli/promise-spawn';
import { color } from 'listr2';
import SemVer from 'semver';
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
	npmOnly: boolean;
	jsrOnly: boolean;
	lastRev: string;
	cleanWorkingTree: boolean;
}

export async function run(options: ResolvedOptions) {
	const git = new Git();

	const ctx = <Ctx>{
		...options,
		npmOnly: options.registries.every((registry) => registry !== 'jsr'),
		jsrOnly: options.registries.every((registry) => registry === 'jsr'),
		lastRev: (await git.latestTag()) || (await git.firstCommit()),
	};

	try {
		await prerequisitesCheckTask({ skip: options.skipPrerequisitesCheck }).run(
			ctx,
		);

		await requiredConditionsCheckTask({
			skip: options.skipConditionsCheck,
		}).run(ctx);

		await createListr<Ctx>([
			{
				skip: options.skipTests,
				title: 'Running tests',
				task: async (ctx) => {
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
				task: async (ctx) => {
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
				task: async (ctx, task) => {
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
				skip: options.skipPublish,
				title: 'Publishing',
				task: (ctx, parentTask) =>
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
				task: async (_, task) => {
					const git = new Git();

					const result = await git.push();

					if (!result) {
						task.title +=
							' (Only tags were pushed because the release branch is protected. Please push the branch manually.)';

						await git.push('--tags');
					}
				},
			},
			{
				skip: options.skipReleaseDraft,
				title: 'Creating release draft on GitHub',
				task: async (ctx, task) => {
					const git = new Git();

					const repositoryUrl = await git.repository();

					const commits = await git.commits(
						ctx.lastRev,
						`${await git.latestTag()}`,
					);

					const latestTag = await git.latestTag();

					let body = commits
						.map(
							({ id, message }) =>
								`- ${message.replace('#', `${repositoryUrl}/issues/`)} ${repositoryUrl}/commit/${id}`,
						)
						.join('\n');

					body += `\n\n${repositoryUrl}/compare/${ctx.lastRev}...${latestTag}`;

					const releaseDraftUrl = new URL(`${repositoryUrl}/releases/new`);

					releaseDraftUrl.searchParams.set('tag', `${latestTag}`);
					releaseDraftUrl.searchParams.set('body', body);
					releaseDraftUrl.searchParams.set(
						'isPrerelease',
						`${!!prerelease(ctx.version)}`,
					);

					const linkUrl = link('Link', releaseDraftUrl.toString());

					task.title += ` ${linkUrl}`;

					await open(releaseDraftUrl.toString());
				},
			},
		]).run(ctx);

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
