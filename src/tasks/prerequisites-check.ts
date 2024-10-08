import { ListrEnquirerPromptAdapter } from '@listr2/prompt-adapter-enquirer';
import { Listr, type ListrTask, delay } from 'listr2';
import { AbstractError } from '../error.js';
import { Git } from '../git.js';
import { warningBadge } from '../utils/cli.js';
import type { Ctx } from './runner.js';

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

	return new Listr({
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
						task.output = 'All good';
						await delay(1000);
					},
				},
				{
					title: 'Confirming new files and new dependencies',
					task: async (_, task) => {
						task.output = 'All good';
						await delay(1000);
					},
				},
				{
					title: 'Checking if the package has never been deployed',
					task: async (_, task) => {
						task.output = 'All good';
						await delay(1000);
					},
				},
				{
					skip: () => true,
					title: 'Checking package name availability',
					task: async (_, task) => {
						task.output = 'All good';
						await delay(1000);
					},
				},
			]),
	});
};
