import { type ListrTask, delay } from 'listr2';
import type { Ctx } from './runner.js';

export const prerequisitesCheckTask: ListrTask<Ctx> = {
	title: 'Prerequisites check (for deployment reliability)',
	task: (_, parentTask) =>
		parentTask.newListr([
			{
				title: 'prerequisite 1',
				task: async (_, task) => {
					task.output = 'All good';
					await delay(1000);
				},
				exitOnError: true,
			},
		]),
};
