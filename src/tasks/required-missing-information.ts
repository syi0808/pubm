import { ListrEnquirerPromptAdapter } from '@listr2/prompt-adapter-enquirer';
import { type Listr, type ListrTask, color } from 'listr2';
import semver from 'semver';
import { defaultOptions } from '../options.js';
import { jsrRegistry } from '../registry/jsr.js';
import { npmRegistry } from '../registry/npm.js';
import { createListr } from '../utils/listr.js';
import { version } from '../utils/package.js';

const { RELEASE_TYPES, SemVer, prerelease } = semver;

interface Ctx {
	version?: string;
	tag: string;
}

export const requiredMissingInformationTasks = (
	options?: Omit<ListrTask<Ctx>, 'title' | 'task'>,
): Listr<Ctx> =>
	createListr<Ctx>({
		...options,
		title: 'Checking required information',
		task: (_, parentTask): Listr<Ctx> =>
			parentTask.newListr([
				{
					title: 'Checking version information',
					skip: (ctx) => !!ctx.version,
					task: async (ctx, task): Promise<void> => {
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
					task: async (ctx, task): Promise<void> => {
						const npm = await npmRegistry();
						const jsr = await jsrRegistry();
						const distTags = [
							...new Set(
								(await Promise.all([npm.distTags(), jsr.distTags()])).flat(),
							),
						].filter((tag) => tag !== defaultOptions.tag);

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
