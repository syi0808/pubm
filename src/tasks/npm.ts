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
	task: (_, parentTask) =>
		parentTask.newListr([
			{
				title: 'Running npm publish',
				task: async (_, task): Promise<void> => {
					const npm = await npmRegistry();

					task.output = 'Publishing on npm...';

					let result = await npm.publish();

					if (!result) {
						task.title = 'Running npm publish (OTP code needed)';

						while (!result) {
							task.output = '2FA failed';

							result = await npm.publish(
								await task.prompt(ListrEnquirerPromptAdapter).run<string>({
									type: 'password',
									message: 'npm OTP code',
								}),
							);
						}

						task.title = 'Running npm publish (2FA passed)';
					}
				},
			},
		]),
};
