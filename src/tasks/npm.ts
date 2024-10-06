import { ListrEnquirerPromptAdapter } from '@listr2/prompt-adapter-enquirer';
import { type ListrTask, PRESET_TIMER } from 'listr2';
import type { Ctx } from './runner';

export const npmPubmTasks: ListrTask<Ctx> = {
	title: 'npm',
	task: (ctx, task) =>
		task.newListr(
			[
				{
					title: 'npm publish',
					task: async (_, task): Promise<void> => {
						task.title = 'npm publish [OTP needed]';
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
											message: 'npm OTP code: ',
										});

									if (response === '123123') throw new Error('asd');

									resolve();
								} catch {
									response = await task
										.prompt(ListrEnquirerPromptAdapter)
										.run<boolean>({
											type: 'password',
											message: 'npm OTP code: ',
										});

									resolve();
								}
							})();
						});

						await ctx.progressingPrompt;

						task.title = `npm publish [OTP passed] ${response}`;
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
