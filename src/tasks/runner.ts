import { ListrEnquirerPromptAdapter } from '@listr2/prompt-adapter-enquirer';
import { Listr, PRESET_TIMER, delay } from 'listr2';

interface Ctx {
	progressingPrompt?: Promise<void>;
}

const tasks = new Listr<Ctx>(
	[
		{
			title: 'npm publish',
			task: (ctx, task): Listr<Ctx> =>
				task.newListr(
					[
						{
							title: 'This task will execute.',
							task: async (): Promise<void> => {
								await delay(1000);
							},
						},
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
												})
												.then();

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
		},
		{
			title: 'jsr publish',
			task: (ctx, parentTask): Listr<Ctx> =>
				parentTask.newListr(
					[
						{
							title: 'This task will execute.',
							task: async (): Promise<void> => {
								await delay(1000);
							},
						},
						{
							title: 'jsr publish',
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
												})
												.then();

											if (response === '123123') throw new Error('error');

											resolve();
										} catch {
											// task.
											parentTask.run(ctx);
											// response = await task
											// 	.prompt(ListrEnquirerPromptAdapter)
											// 	.run<boolean>({
											// 		type: 'password',
											// 		message: 'jsr OTP code: ',
											// 	});

											// resolve();
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
		},
	],
	{
		exitOnError: true,
		concurrent: true,
	},
);

export async function run() {
	try {
		await tasks.run();
	} catch (e) {
		console.error(e);
	}
}
