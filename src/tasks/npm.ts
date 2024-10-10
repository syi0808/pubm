import { ListrEnquirerPromptAdapter } from '@listr2/prompt-adapter-enquirer';
import { type ListrTask, PRESET_TIMER, color } from 'listr2';
import { AbstractError } from '../error.js';
import { npmRegistry } from '../registry/npm.js';
import { link } from '../utils/cli.js';
import type { Ctx } from './runner.js';

class NpmAvailableError extends AbstractError {
	name = 'npm is unavailable for publishing.';

	constructor(message: string, { cause }: { cause?: unknown } = {}) {
		super(message, { cause });

		this.stack = '';
	}
}

export const npmAvailableCheckTasks: ListrTask<Ctx> = {
	title: 'Checking npm avaliable for publising',
	task: async () => {
		const npm = await npmRegistry();

		if (await npm.isPublished()) {
			if (!(await npm.hasPermission())) {
				throw new NpmAvailableError(
					`You do not have permission to publish this package on ${color.green('npm')}.`,
				);
			}

			return void 0;
		}

		if (!(await npm.isPackageNameAvaliable())) {
			throw new NpmAvailableError(
				`Package is not published on ${color.green('npm')}, and the package name is not available. Please change the package name.
More information: ${link('npm naming rules', 'https://github.com/npm/validate-npm-package-name?tab=readme-ov-file#naming-rules')}`,
			);
		}
	},
};

export const npmPublishTasks: ListrTask<Ctx> = {
	title: 'npm',
	task: (ctx, task) =>
		task.newListr(
			[
				{
					title: 'Running npm publish',
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
											message: 'npm OTP code',
										});

									if (response === '123123') throw new Error('asd');

									resolve();
								} catch {
									response = await task
										.prompt(ListrEnquirerPromptAdapter)
										.run<boolean>({
											type: 'password',
											message: 'npm OTP code',
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
