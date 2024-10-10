import { type Listr, type ListrTask, delay } from 'listr2';
import { createListr } from '../utils/listr.js';
import type { Ctx } from './runner.js';

export const requiredConditionsCheckTask: (
	options?: Omit<ListrTask<Ctx>, 'title' | 'task'>,
) => Listr<Ctx> = (options) =>
	createListr({
		...options,
		title: 'Required conditions check (for pubm tasks)',
		task: (_, parentTask) =>
			parentTask.newListr(
				[
					{
						title: 'Ping registries',
						task: async (_, task) => {
							task.output = 'All good';
							await delay(1000);
						},
					},
					{
						title: 'Checking if test and build scripts exist',
						task: async (_, task) => {
							task.output = 'All good';
							await delay(1000);
						},
					},
					{
						title: 'Checking package manager version',
						task: async (_, task) => {
							task.output = 'All good';
							await delay(1000);
						},
					},
					{
						skip: () => true,
						title: 'Verifying user authentication',
						task: async (_, task) => {
							task.output = 'All good';
							await delay(1000);
						},
					},
					{
						title: 'Checking git version',
						task: async (_, task) => {
							task.output = 'All good';
							await delay(1000);
						},
					},
					{
						title: 'Checking git tag existence',
						task: async (_, task) => {
							task.output = 'All good';
							await delay(1000);
						},
					},
					{
						title: 'Verifying current branch is a release branch',
						task: async (_, task) => {
							task.output = 'All good';
							await delay(1000);
						},
					},
					{
						title: 'Checking if registry cli are installed',
						task: async (_, task) => {
							task.output = 'All good';
							await delay(1000);
						},
					},
				],
				{
					concurrent: true,
				},
			),
	});
