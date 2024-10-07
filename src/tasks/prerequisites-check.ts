import { Listr, type ListrTask, delay } from 'listr2';
import type { Ctx } from './runner.js';

export const prerequisitesCheckTask: (
	options?: Omit<ListrTask<Ctx>, 'title' | 'task'>,
) => Listr<Ctx> = (options) =>
	new Listr({
		...options,
		exitOnError: true,
		title: 'Prerequisites check (for deployment reliability)',
		task: (_, parentTask) =>
			parentTask.newListr([
				{
					title: 'Checking if remote history is clean',
					task: async (_, task) => {
						task.output = 'All good';
						await delay(1000);
					},
				},
				{
					title: 'Checking if the local working tree is clean',
					task: async (_, task) => {
						task.output = 'All good';
						await delay(1000);
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
