import { ListrEnquirerPromptAdapter } from '@listr2/prompt-adapter-enquirer';
import { type ListrTask, PRESET_TIMER, color } from 'listr2';
import { AbstractError } from '../error.js';
import { Git } from '../git.js';
import { jsrRegistry } from '../registry/jsr.js';
import { npmRegistry } from '../registry/npm.js';
import { link } from '../utils/cli.js';
import { Db } from '../utils/db.js';
import { getScope, isScopedPackage } from '../utils/package-name.js';
import { patchCachedJsrJson } from '../utils/package.js';
import { addRollback } from '../utils/rollback.js';
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

interface JsrCtx extends Ctx {
	scopeCreated: boolean;
	packageCreated: boolean;
}

export const jsrAvailableCheckTasks: ListrTask<JsrCtx> = {
	title: 'Checking jsr avaliable for publising',
	task: async (ctx, task) => {
		const jsr = await jsrRegistry();

		addRollback(async (ctx) => {
			if (ctx.packageCreated) {
				console.log(`Deleting jsr package ${jsr.packageName}...`);

				await jsr.client.deletePackage(jsr.packageName);
			}

			if (ctx.scopeCreated) {
				console.log(`Deleting jsr scope ${getScope(jsr.packageName)}...`);

				await jsr.client.deleteScope(`${getScope(jsr.packageName)}`);
			}
		}, ctx);

		if (!jsr.client.token) {
			let token = new Db().get('jsr-token');

			if (!token) {
				task.output = 'Retrieving jsr API token';

				while (true) {
					token = await task.prompt(ListrEnquirerPromptAdapter).run<string>({
						type: 'password',
						message: `Please enter the jsr ${color.bold('API token')}`,
						footer: `\nGenerate a token from ${color.bold(link('jsr.io', 'https://jsr.io/account/tokens/create/'))}. ${color.red('You should select')} ${color.bold("'Interact with the JSR API'")}.`,
					});

					jsr.client.token = token;

					try {
						if (await jsr.client.user()) break;

						task.output =
							'The jsr API token is invalid. Please re-enter a valid token.';
					} catch {}
				}
			}

			jsr.client.token = token;

			new Db().set('jsr-token', jsr.client.token);
		}

		if (!isScopedPackage(jsr.packageName)) {
			let jsrName = new Db().get(jsr.packageName);

			task.output =
				'The package name is not scoped. Searching for available scopes on jsr.';

			const scopes = await jsr.client.scopes();

			// biome-ignore lint/suspicious/noConfusingLabels: <explanation>
			checkScopeTask: if (!jsrName) {
				task.output = 'Select an existing published package to publish.';

				const searchResults = (
					await Promise.all(
						scopes.map((scope) =>
							jsr.client.package(`@${scope}/${jsr.packageName}`),
						),
					)
				).filter((v) => v);

				if (searchResults.length > 0) {
					jsrName = await task.prompt(ListrEnquirerPromptAdapter).run<string>({
						type: 'select',
						message:
							'Is there a scoped package you want to publish in the already published list?',
						choices: [
							...searchResults.map(({ scope, name }) => ({
								message: `@${scope}/${name}`,
								name: `@${scope}/${name}`,
							})),
							{
								message: 'None',
								name: 'none',
							},
						],
					});

					if (jsrName !== 'none') break checkScopeTask;
				}

				const userName = await new Git().userName();

				task.output = 'Select the scope of the package to publish';

				jsrName = await task.prompt(ListrEnquirerPromptAdapter).run<string>({
					type: 'select',
					message:
						"jsr.json does not exist, and the package name is not scoped. Please select a scope for the 'jsr' package",
					choices: [
						{
							message: `@${jsr.packageName}/${jsr.packageName} ${color.dim('scoped by package name')}${scopes.includes(jsr.packageName) ? ' (already created)' : ''}`,
							name: `@${jsr.packageName}/${jsr.packageName}`,
						},
						{
							message: `@${userName}/${jsr.packageName} ${color.dim('scoped by git name')}${scopes.includes(userName) ? ' (already created)' : ''}`,
							name: `@${userName}/${jsr.packageName}`,
						},
						...scopes.flatMap((scope) =>
							scope === jsr.packageName || scope === userName
								? []
								: [
										{
											message: `@${scope}/${jsr.packageName} ${color.dim('scope from jsr')}`,
											name: `@${scope}/${jsr.packageName}`,
										},
									],
						),
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

				const scope = jsrName.match(/^@([^/]+)/)?.[1];

				if (scope && !scopes.includes(scope)) {
					task.output = 'Creating scope for jsr...';
					await jsr.client.createScope(scope);
					ctx.scopeCreated = true;
				}

				if (ctx.scopeCreated || !(await jsr.client.package(jsrName))) {
					task.output = 'Creating package for jsr...';
					await jsr.client.createPackage(jsrName);
					ctx.packageCreated = true;
				}
			}

			jsr.packageName = jsrName;

			patchCachedJsrJson({ name: jsr.packageName });
		}

		const npm = await npmRegistry();

		if (
			isScopedPackage(npm.packageName) &&
			!(await jsr.client.scopePermission(`${getScope(npm.packageName)}`))
		) {
			throw new JsrAvailableError(
				`You do not have permission to publish scope '${getScope(npm.packageName)}'. If you want to claim it, please contact ${link('help@jsr.io', 'mailto:help@jsr.io')}.`,
			);
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
