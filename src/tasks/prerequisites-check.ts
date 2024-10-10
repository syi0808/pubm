import { ListrEnquirerPromptAdapter } from '@listr2/prompt-adapter-enquirer';
import type { Listr, ListrTask } from 'listr2';
import { AbstractError } from '../error.js';
import { Git } from '../git.js';
import { warningBadge } from '../utils/cli.js';
import { createListr } from '../utils/listr.js';
import { jsrAvailableCheckTasks } from './jsr.js';
import { npmAvailableCheckTasks } from './npm.js';
import type { Ctx } from './runner.js';
import { Manager } from '@listr2/manager';

class PrerequisitesCheckError extends AbstractError {
	name = 'Failed prerequisite check';

	constructor(message: string, { cause }: { cause?: unknown } = {}) {
		super(message, { cause });

		this.stack = '';
	}
}

export const prerequisitesCheckTask: (
	options?: Omit<ListrTask<Ctx>, 'title' | 'task'>,
) => Listr<Ctx> = (options) => {
	const git = new Git();

	return createListr({
		...options,
		exitOnError: true,
		title: 'Prerequisites check (for deployment reliability)',
		task: (_, parentTask) =>
			parentTask.newListr([
				{
					title: 'Checking if remote history is clean',
					task: async (_, task) => {
						task.output = 'Checking for updates with `git fetch`';

						if ((await git.dryFetch()).trim()) {
							throw new PrerequisitesCheckError(
								'Local history is outdated. Please run `git fetch` to update.',
							);
						}

						task.output = 'Checking for updates with `git pull`';
						if (await git.revisionDiffsCount()) {
							throw new PrerequisitesCheckError(
								'Local history is outdated. Please run `git pull` to synchronize with the remote repository.',
							);
						}
					},
				},
				{
					title: 'Checking if the local working tree is clean',
					task: async (_, task) => {
						if (await git.status()) {
							task.output = 'Local working tree is not clean.';

							if (
								!(await task.prompt(ListrEnquirerPromptAdapter).run<boolean>({
									type: 'toggle',
									message: `${warningBadge} Local working tree is not clean. Do you want to skip?`,
									enabled: 'Yes',
									disabled: 'No',
								}))
							) {
								throw new PrerequisitesCheckError(
									'Local working tree is not clean. Please commit or stash your changes before proceeding.',
								);
							}
						}
					},
				},
				{
					title: 'Checking if commits exist since the last release',
					task: async (_, task) => {
						const latestTag = await git.latestTag();

						if (!latestTag) {
							task.title += ' (Tag has not been pushed to GitHub)';
							return void 0;
						}

						if ((await git.commits(latestTag, 'HEAD')).length <= 0) {
							if (
								!(await task.prompt(ListrEnquirerPromptAdapter).run<boolean>({
									type: 'toggle',
									message: `${warningBadge} No commits exist from the latest tag. Do you want to skip?`,
									enabled: 'Yes',
									disabled: 'No',
								}))
							) {
								throw new PrerequisitesCheckError(
									'No commits exist from the latest tag. Please ensure there are new changes before publishing.',
								);
							}
						}
					},
				},
				{
					title: 'Checking available registries for publishing',
					task: async (ctx, parentTask) =>
						parentTask.newListr(
							ctx.registries.map((registryKey) => {
								switch (registryKey) {
									case 'npm':
										return npmAvailableCheckTasks;
									case 'jsr':
										return jsrAvailableCheckTasks;
									default:
										return npmAvailableCheckTasks;
								}
							}),
							{
								concurrent: true,
							},
						),
				},
			]),
	});
};
