import process from 'node:process';
import { ListrEnquirerPromptAdapter } from '@listr2/prompt-adapter-enquirer';
import { type ListrTask, color } from 'listr2';
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
	skip: (ctx) => !!ctx.preview,
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
	title: 'Running npm publish',
	skip: (ctx) => !!ctx.preview,
	task: async (ctx, task): Promise<void> => {
		const npm = await npmRegistry();

		task.output = 'Publishing on npm...';

		if (ctx.promptEnabled) {
			let result = await npm.publish();

			if (!result) {
				task.title = 'Running npm publish (OTP code needed)';

				while (!result) {
					result = await npm.publish(
						await task.prompt(ListrEnquirerPromptAdapter).run<string>({
							type: 'password',
							message: 'npm OTP code',
						}),
					);

					if (!result) {
						task.output = '2FA failed';
					}
				}

				task.title = 'Running npm publish (2FA passed)';
			}
		} else {
			const npmTokenEnv = process.env.NODE_AUTH_TOKEN;

			if (!npmTokenEnv) {
				throw new NpmAvailableError(
					'NODE_AUTH_TOKEN not found in the environment variables. Please set the token and try again.',
				);
			}

			const result = await npm.publishProvenance();

			if (!result) {
				throw new NpmAvailableError(
					`In CI environment, publishing with 2FA is not allowed. Please disable 2FA when accessing with a token from https://www.npmjs.com/package/${npm.packageName}/access`,
				);
			}
		}
	},
};
