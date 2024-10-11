import { ListrEnquirerPromptAdapter } from '@listr2/prompt-adapter-enquirer';
import type { Listr, ListrTask } from 'listr2';
import { AbstractError } from '../error.js';
import { Git } from '../git.js';
import { getRegistry } from '../registry/index.js';
import { jsrRegistry } from '../registry/jsr.js';
import { npmRegistry } from '../registry/npm.js';
import { warningBadge } from '../utils/cli.js';
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
						title: 'Verifying if npm and jsr are installed',
						task: async (_, parentTask) =>
							parentTask.newListr(
								[
									{
										enabled: (ctx) =>
											ctx.registries.some((registry) => registry !== 'jsr'),
										title: 'Verifying if npm are installed',
										task: async () => {
											const npm = await npmRegistry();

											if (!(await npm.isInstalled())) {
												throw new RequiredConditionCheckError(
													'npm is not installed. Please install npm to proceed.',
												);
											}
										},
									},
									{
										enabled: (ctx) =>
											ctx.registries.some((registry) => registry === 'jsr'),
										title: 'Verifying if jsr are installed',
										task: async (_, task) => {
											const jsr = await jsrRegistry();

											if (!(await jsr.isInstalled())) {
												const install = await task
													.prompt(ListrEnquirerPromptAdapter)
													.run<boolean>({
														type: 'toggle',
														message: `${warningBadge} jsr is not installed. Do you want to install jsr?`,
														enabled: 'Yes',
														disabled: 'No',
													});

												if (install) {
													task.output = 'Installing jsr...';

													const npm = await npmRegistry();

													await npm.installGlobally('jsr');
												} else {
													throw new RequiredConditionCheckError(
														'jsr is not installed. Please install jsr to proceed.',
													);
												}
											}
										},
									},
								],
								{
									concurrent: true,
								},
							),
					},
					{
						title: 'Checking if test and build scripts exist',
						skip: (ctx) => ctx.jsrOnly,
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
