import cac from 'cac';
import type { OptionConfig } from 'cac/deno/Option.js';
import enquirer from 'enquirer';
import semver, { SemVer } from 'semver';
import c from 'tinyrainbow';
import { pubm } from './index.js';
import type { Options } from './types/options.js';
import { version } from './utils/version.js';

const { prompt } = enquirer;
const { RELEASE_TYPES } = semver;

interface CliOptions {
	version: string;
	testScript: string;
	preview?: boolean;
	branch: string;
	anyBranch?: boolean;
	cleanup: boolean;
	tests: boolean;
	build: boolean;
	publish: boolean;
	releaseDraft: boolean;
	yolo?: boolean;
	tag: string;
	packageManager?: string;
	contents?: string;
	registry?: string;
}

const options: {
	rawName: string;
	description: string;
	options?: OptionConfig;
}[] = [
	{
		rawName: '--test-script <script>',
		description: 'The npm script to run tests before publishing',
		options: { default: 'test', type: String },
	},
	{
		rawName: '-p, --preview',
		description: 'Show tasks without actually executing publish',
		options: { type: Boolean },
	},
	{
		rawName: '-b, --branch <name>',
		description: 'Name of the release branch',
		options: { default: 'main', type: String },
	},
	{
		rawName: '-a, --any-branch',
		description: 'Show tasks without actually executing publish',
		options: { type: Boolean },
	},
	{
		rawName: '--no-cleanup',
		description: 'Skip cleaning the `node_modules` directory',
		options: { type: Boolean },
	},
	{
		rawName: '--no-tests',
		description: 'Skip running tests before publishing',
		options: { type: Boolean },
	},
	{
		rawName: '--no-build',
		description: 'Skip build before publishing',
		options: { type: Boolean },
	},
	{
		rawName: '--no-publish',
		description: 'Skip publishing task',
		options: { type: Boolean },
	},
	{
		rawName: '--no-release-draft',
		description: 'Skip creating a GitHub release draft',
		options: { type: Boolean },
	},
	{
		rawName: '-y, --yolo',
		description: 'Skip both cleanup and tests',
		options: { type: Boolean },
	},
	{
		rawName: '-t, --tag <name>',
		description: 'Publish under a specific dist-tag',
		options: { default: 'latest', type: String },
	},
	{
		rawName: '--package-manager <name>',
		description: `Use a specific package manager 'packageManager' field in package.json or package manager configuration file`,
		options: { type: String },
	},
	{
		rawName: '-c, --contents <path>',
		description: 'Subdirectory to publish',
		options: { type: String },
	},
	{
		rawName: '--registry <...registries>',
		description:
			'Target registries for publish\nregistry can be npm | jsr | https://url.for.private-registries',
		options: { type: String, default: 'npm,jsr' },
	},
];

const cli = cac('pubm');

for (const option of options) {
	// biome-ignore lint/suspicious/noExplicitAny: <explanation>
	cli.option(option.rawName, option.description, option.options as any);
}

function resolveCliOptions(options: CliOptions): Options {
	return {
		...options,
		skipCleanup: !options.cleanup,
		skipPublish: !options.publish,
		skipReleaseDraft: !options.releaseDraft,
		skipTests: !options.tests,
		skipBuild: !options.build,
		registries: options.registry?.split(','),
	};
}

cli
	.command('[version]')
	.action(async (versionArg, options: Omit<CliOptions, 'version'>) => {
		console.clear();

		const currentVersion = await version();
		let nextVersion = versionArg;

		if (!nextVersion) {
			nextVersion = (
				await prompt<{ version: string }>({
					type: 'select',
					choices: RELEASE_TYPES.map((releaseType) => {
						const increasedVersion = new SemVer(currentVersion)
							.inc(releaseType)
							.toString();

						return {
							message: `${releaseType} ${c.dim(increasedVersion)}`,
							name: increasedVersion,
						};
					}).concat([
						{ message: 'Custom version (specify)', name: 'specific' },
					]),
					message: 'Select SemVer increment or specify new version',
					name: 'version',
				})
			).version;

			if (nextVersion === 'specific') {
				nextVersion = (
					await prompt<{ version: string }>({
						type: 'input',
						message: 'Version',
						name: 'version',
					})
				).version;
			}
		}

		await pubm(
			resolveCliOptions({
				...options,
				version: nextVersion,
			}),
		);
	});

cli.help((sections) => {
	sections[1].body += `\n\n  Version can be:\n    ${RELEASE_TYPES.join(' | ')} | 1.2.3`;
	sections.splice(2, 2);
	sections.push({ body: '\n' });
});

(async () => {
	cli.version(await version({ cwd: import.meta.dirname }));

	cli.parse();
})();
