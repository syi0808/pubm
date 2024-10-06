import { delay, Listr } from 'listr2';
import type { Ctx } from './runner.js';

export const prerequisiteTasks = new Listr<Ctx>([
	{
		title: 'Prerequisites',
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
