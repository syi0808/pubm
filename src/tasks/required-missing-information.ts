import { type ListrTask, delay } from 'listr2';
import type { Ctx } from './runner.js';

export const requiredMissingInformationTasks: ListrTask<Ctx> = {
	title: 'Required missing information',
	task: (_, parentTask) =>
		parentTask.newListr([
			{
				title: 'prerequisite 1 ',
				task: async () => {
					// console.log('All good');
					await delay(1000);
				},
				exitOnError: true,
			},
		]),
};
