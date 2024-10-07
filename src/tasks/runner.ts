import { Listr, delay } from 'listr2';
import type { ResolvedOptions } from '../types/options.js';
import { packageName } from '../utils/package-json.js';
import { jsrPubmTasks } from './jsr.js';
import { npmPubmTasks } from './npm.js';
import { prerequisitesCheckTask } from './prerequisites-check.js';
import { requiredConditionsCheckTask } from './required-conditions-check.js';

export interface Ctx extends ResolvedOptions {
	progressingPrompt?: Promise<void>;
}

export async function run(options: ResolvedOptions) {
	const ctx = { ...options };

	try {
		await prerequisitesCheckTask({ skip: options.skipPrerequisitesCheck }).run(
			ctx,
		);

		await requiredConditionsCheckTask({
			skip: options.skipConditionsCheck,
		}).run(ctx);

		await new Listr([
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
				task: (_, parentTask) =>
					parentTask.newListr([npmPubmTasks, jsrPubmTasks], {
						exitOnError: true,
						concurrent: true,
						ctx,
					}),
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

		console.log(
			`
🚀 Successfully published ${await packageName()} v${ctx.version} 🚀
			`,
		);
	} catch (e) {
		console.error(e);
	}
}
