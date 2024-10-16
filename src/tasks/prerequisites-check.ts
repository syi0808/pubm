import { ListrEnquirerPromptAdapter } from '@listr2/prompt-adapter-enquirer';
import type { Listr, ListrTask } from 'listr2';
import { AbstractError } from '../error.js';
import { Git } from '../git.js';
import { warningBadge } from '../utils/cli.js';
import { createListr } from '../utils/listr.js';
import type { Ctx } from './runner.js';

class PrerequisitesCheckError extends AbstractError {
	name = 'Failed prerequisite check';

	constructor(message: string, { cause }: { cause?: unknown } = {}) {
		super(message, { cause });

		this.stack = '';
	}
}

export const prerequisitesCheckTask = (
	options?: Omit<ListrTask<Ctx>, 'title' | 'task'>,
): Listr<Ctx> => {
	const git = new Git();

	return createListr({
		...options,
		exitOnError: true,
		title: 'Prerequisites check (for deployment reliability)',
		task: (_, parentTask) =>
			parentTask.newListr([
				{
					skip: (ctx) => !!ctx.anyBranch,
					title: 'Verifying current branch is a release branch',
					task: async (ctx, task): Promise<void> => {
						if ((await git.branch()) !== ctx.branch) {
							const swtichBranch = await task
								.prompt(ListrEnquirerPromptAdapter)
								.run<boolean>({
									type: 'toggle',
									message: `${warningBadge} The current HEAD branch is not the release target branch. Do you want to switch branch to ${ctx.branch}?`,
									enabled: 'Yes',
									disabled: 'No',
								});

							if (swtichBranch) {
								task.output = `Switching branch to ${ctx.branch}...`;
								await git.switch(ctx.branch);
							} else {
								throw new PrerequisitesCheckError(
									'The current HEAD branch is not the release target branch. Please switch to the correct branch before proceeding.',
								);
							}
						}
					},
				},
				{
					title: 'Checking if remote history is clean',
					task: async (_, task): Promise<void> => {
						task.output = 'Checking for updates with `git fetch`';

						if ((await git.dryFetch()).trim()) {
							const fetch = await task
								.prompt(ListrEnquirerPromptAdapter)
								.run<boolean>({
									type: 'toggle',
									message: `${warningBadge} Local history is outdated. Do you want to run \`git fetch\`?`,
									enabled: 'Yes',
									disabled: 'No',
								});

							if (fetch) {
								task.output = 'Executing `git fetch` command...';
								await git.fetch();
							} else {
								throw new PrerequisitesCheckError(
									'Local history is outdated. Please run `git fetch` to update.',
								);
							}
						}

						task.output = 'Checking for updates with `git pull`';
						if (await git.revisionDiffsCount()) {
							const pull = await task
								.prompt(ListrEnquirerPromptAdapter)
								.run<boolean>({
									type: 'toggle',
									message: `${warningBadge} Local history is outdated. Do you want to run \`git pull\`?`,
									enabled: 'Yes',
									disabled: 'No',
								});

							if (pull) {
								task.output = 'Executing `git pull` command...';
								await git.pull();
							} else {
								throw new PrerequisitesCheckError(
									'Local history is outdated. Please run `git pull` to synchronize with the remote repository.',
								);
							}
						}
					},
				},
				{
					title: 'Checking if the local working tree is clean',
					task: async (ctx, task): Promise<void> => {
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

							ctx.cleanWorkingTree = false;
						}

						ctx.cleanWorkingTree = true;
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
					title: 'Checking git tag existence',
					task: async (ctx, task): Promise<void> => {
						const gitTag = `v${ctx.version}`;

						if (await git.checkTagExist(gitTag)) {
							const deleteTag = await task
								.prompt(ListrEnquirerPromptAdapter)
								.run<boolean>({
									type: 'toggle',
									message: `${warningBadge} The Git tag '${gitTag}' already exists. Do you want to delete tag?`,
									enabled: 'Yes',
									disabled: 'No',
								});

							if (deleteTag) {
								task.output = `Deleting git tag ${gitTag}...`;
								await git.deleteTag(gitTag);
							} else {
								throw new PrerequisitesCheckError(
									`The Git tag '${gitTag}' already exists. Please check the selected version '${ctx.version}'.`,
								);
							}
						}
					},
				},
			]),
	});
};
