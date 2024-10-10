import { color, delay } from 'listr2';
import { consoleError } from '../error.js';
import type { ResolvedOptions } from '../types/options.js';
import { createListr } from '../utils/listr.js';
import { getJsrJson, getPackageJson } from '../utils/package.js';
import { rollback } from '../utils/rollback.js';
import { jsrPublishTasks } from './jsr.js';
import { npmPublishTasks } from './npm.js';
import { prerequisitesCheckTask } from './prerequisites-check.js';
import { requiredConditionsCheckTask } from './required-conditions-check.js';

export interface Ctx extends ResolvedOptions {
	progressingPrompt?: Promise<void>;
	npmOnly: boolean;
	jsrOnly: boolean;
}

export async function run(options: ResolvedOptions) {
	const ctx = <Ctx>{
		...options,
		npmOnly: options.registries.every((registry) => registry !== 'jsr'),
		jsrOnly: options.registries.every((registry) => registry === 'jsr'),
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
				task: async (_, task) => {
					task.output = 'All good';
					await delay(1000);
				},
			},
			{
				skip: options.skipBuild,
				title: 'Building the project',
				task: async (_, task) => {
					task.output = 'All good';
					await delay(1000);
				},
			},
			{
				title: 'Bumping version',
				task: async (_, task) => {
					task.output = 'All good';
					await delay(1000);
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
						{
							exitOnError: true,
							concurrent: true,
							ctx,
						},
					),
			},
			{
				title: 'Pushing tags to GitHub',
				task: async (_, task) => {
					task.output = 'All good';
					await delay(1000);
				},
			},
			{
				skip: options.skipReleaseDraft,
				title: 'Creating release draft on GitHub',
				task: async (_, task) => {
					task.output = 'All good';
					await delay(1000);
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
