import { delay, Listr } from 'listr2';
import type { Ctx } from './runner.js';

export const requiredCheckTasks = new Listr<Ctx>([
	{
		title: 'Required checks',
		task: (_ctx, parentTask) =>
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
	},
]);
