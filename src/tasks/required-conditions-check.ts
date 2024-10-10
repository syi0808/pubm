import type { Listr, ListrTask } from 'listr2';
import { AbstractError } from '../error.js';
import { Git } from '../git.js';
import { getRegistry } from '../registry/index.js';
import { validateEngineVersion } from '../utils/engine-version.js';
import { createListr } from '../utils/listr.js';
import { getPackageJson } from '../utils/package.js';
import { jsrAvailableCheckTasks } from './jsr.js';
import { npmAvailableCheckTasks } from './npm.js';
import type { Ctx } from './runner.js';

class RequiredConditionCheckError extends AbstractError {
	name = 'Failed required condition check';

	constructor(message: string, { cause }: { cause?: unknown } = {}) {
		super(message, { cause });

		this.stack = '';
	}
}

export const requiredConditionsCheckTask: (
	options?: Omit<ListrTask<Ctx>, 'title' | 'task'>,
) => Listr<Ctx> = (options) =>
	createListr({
		...options,
		title: 'Required conditions check (for pubm tasks)',
		task: (_, parentTask) =>
			parentTask.newListr(
				[
					{
						title: 'Ping registries',
						task: async (ctx, parentTask) =>
							parentTask.newListr(
								ctx.registries.map((registryKey) => ({
									title: `Ping to ${registryKey}`,
									task: async () => {
										const registry = await getRegistry(registryKey);

										await registry.ping();
									},
								})),
								{
									concurrent: true,
								},
							),
					},
					{
						title: 'Checking if test and build scripts exist',
						skip: (ctx) => !ctx.jsrOnly,
						task: async (ctx) => {
							const { scripts } = await getPackageJson();

							const errors: string[] = [];

							if (!ctx.skipTests && !scripts?.[ctx.testScript]) {
								errors.push(`Test script '${ctx.testScript}' does not exist.`);
							}

							if (!ctx.skipBuild && !scripts?.[ctx.buildScript]) {
								errors.push(
									`Build script '${ctx.buildScript}' does not exist.`,
								);
							}

							if (errors.length) {
								throw new RequiredConditionCheckError(
									`${errors.join(' and ')} Please check your configuration.`,
								);
							}
						},
					},
					{
						title: 'Checking git version',
						task: async () => {
							const git = new Git();

							validateEngineVersion('git', `${await git.version()}`);
						},
					},
					{
						title: 'Checking available registries for publishing',
						task: async (ctx, parentTask) =>
							parentTask.newListr(
								ctx.registries.map((registryKey) => {
									switch (registryKey) {
										case 'npm':
											return npmAvailableCheckTasks;
										case 'jsr':
											return jsrAvailableCheckTasks;
										default:
											return npmAvailableCheckTasks;
									}
								}),
								{
									concurrent: true,
								},
							),
					},
				],
				{
					concurrent: true,
				},
			),
	});
