import { ListrEnquirerPromptAdapter } from '@listr2/prompt-adapter-enquirer';
import { color, Listr, type ListrTask } from 'listr2';
import semver from 'semver';
import { defaultOptions } from '../options.js';
import { NpmRegistry } from '../registry/npm.js';
import { packageName, version } from '../utils/package-json.js';

const { RELEASE_TYPES, SemVer, prerelease } = semver;

interface Ctx {
	version?: string;
	tag: string;
}

export const requiredMissingInformationTasks: (
	options?: Omit<ListrTask<Ctx>, 'title' | 'task'>,
) => Listr<Ctx> = (options) =>
	new Listr({
		...options,
		title: 'Checking required information',
		task: (_, parentTask) =>
			parentTask.newListr([
				{
					title: 'Checking version information',
					skip: (ctx) => !!ctx.version,
					task: async (ctx, task) => {
						const currentVersion = await version();

						let nextVersion = await task
							.prompt(ListrEnquirerPromptAdapter)
							.run<string>({
								type: 'select',
								message: 'Select SemVer increment or specify new version',
								choices: RELEASE_TYPES.map((releaseType) => {
									const increasedVersion = new SemVer(currentVersion)
										.inc(releaseType)
										.toString();

									return {
										message: `${releaseType} ${color.dim(increasedVersion)}`,
										name: increasedVersion,
									};
								}).concat([
									{ message: 'Custom version (specify)', name: 'specify' },
								]),
								name: 'version',
							});

						if (nextVersion === 'specify') {
							nextVersion = await task
								.prompt(ListrEnquirerPromptAdapter)
								.run<string>({
									type: 'input',
									message: 'Version',
									name: 'version',
								});
						}

						ctx.version = nextVersion;
					},
					exitOnError: true,
				},
				{
					title: 'Checking tag information',
					skip: (ctx) =>
						!prerelease(`${ctx.version}`) && ctx.tag === defaultOptions.tag,
					task: async (ctx, task) => {
						const npm = new NpmRegistry(await packageName());
						const distTags = [...(await npm.distTags())].filter(
							(tag) => tag !== defaultOptions.tag,
						);

						if (distTags.length <= 0) distTags.push('next');

						let tag = await task
							.prompt(ListrEnquirerPromptAdapter)
							.run<string>({
								type: 'select',
								message: 'Select the tag for this pre-release version in npm',
								choices: distTags
									.map((distTag) => ({
										message: distTag,
										name: distTag,
									}))
									.concat([
										{ message: 'Custom version (specify)', name: 'specify' },
									]),
								name: 'tag',
							});

						if (tag === 'specify') {
							tag = await task.prompt(ListrEnquirerPromptAdapter).run<string>({
								type: 'input',
								message: 'Tag',
								name: 'tag',
							});
						}

						ctx.tag = tag;
					},
					exitOnError: true,
				},
			]),
	});
