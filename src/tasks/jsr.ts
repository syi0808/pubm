import { ListrEnquirerPromptAdapter } from '@listr2/prompt-adapter-enquirer';
import { type ListrTask, PRESET_TIMER } from 'listr2';
import type { Ctx } from './runner.js';

export const jsrPubmTasks: ListrTask<Ctx> = {
	title: 'jsr',
	task: (ctx, parentTask) =>
		parentTask.newListr(
			[
				{
					title: 'Running jsr publish',
					task: async (_, task): Promise<void> => {
						task.title = 'jsr publish [OTP needed]';
						task.output = 'waiting for input OTP code';

						if (ctx.progressingPrompt) await ctx.progressingPrompt;

						let response: unknown;

						ctx.progressingPrompt = new Promise((resolve) => {
							(async () => {
								try {
									response = await task
										.prompt(ListrEnquirerPromptAdapter)
										.run<boolean>({
											type: 'password',
											message: 'jsr OTP code: ',
										});

									if (response === '123123') throw new Error('error');

									resolve();
								} catch {
									response = await task
										.prompt(ListrEnquirerPromptAdapter)
										.run<boolean>({
											type: 'password',
											message: 'jsr OTP code: ',
										});

									resolve();
								}
							})();
						});

						await ctx.progressingPrompt;

						task.title = `jsr publish [OTP passed] ${response}`;
					},
					exitOnError: true,
				},
			],
			{
				concurrent: false,
				collectErrors: 'minimal',
				rendererOptions: { collapseSubtasks: false, timer: PRESET_TIMER },
				fallbackRendererOptions: { timer: PRESET_TIMER },
			},
		),
};
