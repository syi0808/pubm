import cac from 'cac';
import type { OptionConfig } from 'cac/deno/Option.js';
import semver from 'semver';
import { consoleError } from './error.js';
import { pubm } from './index.js';
import { requiredMissingInformationTasks } from './tasks/required-missing-information.js';
import type { Options } from './types/options.js';
import { notifyNewVersion } from './utils/notify-new-version.js';
import { version } from './utils/package.js';

const { RELEASE_TYPES } = semver;

interface CliOptions {
	version: string;
	testScript: string;
	preview?: boolean;
	branch: string;
	anyBranch?: boolean;
	preCheck: boolean;
	conditionCheck: boolean;
	tests: boolean;
	build: boolean;
	publish: boolean;
	releaseDraft: boolean;
	tag: string;
	contents?: string;
	registry?: string;
	saveToken: boolean;
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
		rawName: '--build-script <script>',
		description: 'The npm script to run build before publishing',
		options: { default: 'build', type: String },
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
		rawName: '--no-pre-check',
		description: 'Skip prerequisites check task',
		options: { type: Boolean },
	},
	{
		rawName: '--no-condition-check',
		description: 'Skip required conditions check task',
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
		rawName: '-t, --tag <name>',
		description: 'Publish under a specific dist-tag',
		options: { default: 'latest', type: String },
	},
	{
		rawName: '-c, --contents <path>',
		description: 'Subdirectory to publish',
		options: { type: String },
	},
	{
		rawName: '--no-save-token',
		description: 'Do not save jsr tokens (request the token each time)',
		options: { type: Boolean },
	},
	{
		rawName: '--registry <...registries>',
		description:
			'Target registries for publish\n        registry can be npm | jsr | https://url.for.private-registries',
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
		skipPublish: !options.publish,
		skipReleaseDraft: !options.releaseDraft,
		skipTests: !options.tests,
		skipBuild: !options.build,
		registries: options.registry?.split(','),
		skipPrerequisitesCheck: !options.preCheck,
		skipConditionsCheck: !options.conditionCheck,
	};
}

cli
	.command('[version]')
	.action(async (nextVersion, options: Omit<CliOptions, 'version'>) => {
		console.clear();

		await notifyNewVersion();

		const context = {
			version: nextVersion,
			tag: options.tag,
		};

		try {
			await requiredMissingInformationTasks().run(context);

			await pubm(
				resolveCliOptions({
					...options,
					version: context.version,
					tag: context.tag,
				}),
			);
		} catch (e) {
			consoleError(e as Error);
		}
	});

cli.help((sections) => {
	sections[1].body += `\n\n  Version can be:\n    ${RELEASE_TYPES.join(' | ')} | 1.2.3`;
	sections.splice(2, 2);
	if (sections.at(2)) {
		sections[2].body = sections[2].body.replace(/ \(default: true\)/g, '');
	}
	sections.push({ body: '\n' });
});

(async () => {
	cli.version(await version({ cwd: import.meta.dirname }));

	cli.parse();
})();
