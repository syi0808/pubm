import { ListrEnquirerPromptAdapter } from '@listr2/prompt-adapter-enquirer';
import { type ListrTask, PRESET_TIMER, color } from 'listr2';
import { AbstractError } from '../error.js';
import { jsrRegistry } from '../registry/jsr.js';
import { link } from '../utils/cli.js';
import { Db } from '../utils/db.js';
import { isScopedPackage, patchCachedJsrJson } from '../utils/package.js';
import type { Ctx } from './runner.js';

export const jsrPublishTasks: ListrTask<Ctx> = {
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
											message: 'jsr OTP code',
										});

									if (response === '123123') throw new Error('error');

									resolve();
								} catch {
									response = await task
										.prompt(ListrEnquirerPromptAdapter)
										.run<boolean>({
											type: 'password',
											message: 'jsr OTP code',
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

class JsrAvailableError extends AbstractError {
	name = 'jsr is unavailable for publishing.';

	constructor(message: string, { cause }: { cause?: unknown } = {}) {
		super(message, { cause });

		this.stack = '';
	}
}

export const jsrAvailableCheckTasks: ListrTask<Ctx> = {
	title: 'Checking jsr avaliable for publising',
	task: async (_, task) => {
		const jsr = await jsrRegistry();

		if (!jsr.token) {
			let token = new Db().get('jsr-token');

			if (!token) {
				while (true) {
					token = await task.prompt(ListrEnquirerPromptAdapter).run<string>({
						type: 'password',
						message: `Please enter the jsr ${color.bold('API token')}`,
						footer: `\nGenerate a token from ${color.bold(link('jsr.io', 'https://jsr.io/account/tokens/create/'))}. ${color.red('You should select')} ${color.bold("'Interact with the JSR API'")}.`,
					});

					jsr.token = token;

					try {
						if (await jsr.user()) break;

						task.output =
							'The jsr API token is invalid. Please re-enter a valid token.';
					} catch {}
				}
			}

			new Db().set('jsr-token', jsr.token);
		}

		if (!isScopedPackage(jsr.packageName)) {
			let jsrName = new Db().get(jsr.packageName);

			if (!jsrName) {
				const userName = 'syi0808';

				jsrName = await task.prompt(ListrEnquirerPromptAdapter).run<string>({
					type: 'select',
					message:
						"jsr.json does not exist, and the package name is not scoped. Please select a scope for the 'jsr' package",
					choices: [
						{
							message: `scoped by package name (${color.dim(`@${jsr.packageName}/${jsr.packageName}`)})`,
							name: `@${jsr.packageName}/${jsr.packageName}`,
						},
						{
							message: `scoped by name (${color.dim(`@${userName}/${jsr.packageName}`)})`,
							name: `@${userName}/${jsr.packageName}`,
						},
						{
							message: 'Other (Specify)',
							name: 'specify',
						},
					],
				});

				if (jsrName === 'specify') {
					while (!isScopedPackage(jsrName)) {
						jsrName = await task
							.prompt(ListrEnquirerPromptAdapter)
							.run<string>({
								type: 'input',
								message: 'Package name',
							});
					}
				}
			}

			patchCachedJsrJson({ name: jsrName });
		}

		if (await jsr.isPublished()) {
			if (!(await jsr.hasPermission())) {
				throw new JsrAvailableError(
					`You do not have permission to publish this package on ${color.yellow('jsr')}.`,
				);
			}

			return void 0;
		}

		if (!(await jsr.isPackageNameAvaliable())) {
			throw new JsrAvailableError(
				`Package is not published on ${color.yellow('jsr')}, and the package name is not available. Please change the package name.`,
			);
		}
	},
};
