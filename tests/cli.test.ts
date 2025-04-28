import { test } from 'vitest';
import { runPubmCli } from './utils/cli';
import path from 'node:path';

test('CLI help command', async () => {
	const { controller } = runPubmCli('--help');

	await controller.waitForStdout('pubm');
	await controller.waitForStdout('Options:');
	await controller.waitForStdout('Commands:');
});

test('CLI version command', async () => {
	const { controller } = runPubmCli('--version');

	await controller.waitForStdout('pubm');
});

test('CLI preview mode', async () => {
	const { controller } = runPubmCli(
		'0.0.2',
		'--preview',
		'--no-pre-check',
		'--no-tests',
		'--no-build',
		'--no-publish',
	);

	await controller.waitForStdout('Preview mode');
});

test('CLI publish-only mode', async () => {
	const { controller } = runPubmCli(
		'--publish-only',
		'--no-pre-check',
		'--no-tests',
		'--no-build',
	);

	await controller.waitForStderr('Cannot find the latest tag');
});

test('CLI with custom tag', async () => {
	const { controller } = runPubmCli(
		'0.0.2',
		'--tag',
		'beta',
		'--no-pre-check',
		'--no-tests',
		'--no-build',
		'--no-publish',
	);

	await controller.waitForStderr(
		'The current HEAD branch is not the release target branch',
	);
});
