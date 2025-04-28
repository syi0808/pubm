import { test } from 'vitest';
import { runPubmCli } from './utils/cli';
import path from 'node:path';

test('npm registry only', async () => {
	const { controller } = runPubmCli(
		'0.0.2',
		'--registry',
		'npm',
		'--no-pre-check',
		'--no-tests',
		'--no-build',
		'--no-publish',
	);

	await controller.waitForStderr(
		'The current HEAD branch is not the release target branch',
	);
});

test('jsr registry only', async () => {
	const { controller } = runPubmCli(
		'0.0.2',
		'--registry',
		'jsr',
		'--no-pre-check',
		'--no-tests',
		'--no-build',
		'--no-publish',
	);

	await controller.waitForStderr(
		'The current HEAD branch is not the release target branch',
	);
});

test('multiple registries', async () => {
	const { controller } = runPubmCli(
		'0.0.2',
		'--registry',
		'npm,jsr',
		'--no-pre-check',
		'--no-tests',
		'--no-build',
		'--no-publish',
	);

	await controller.waitForStderr(
		'The current HEAD branch is not the release target branch',
	);
});

test('private registry', async () => {
	const { controller } = runPubmCli(
		'0.0.2',
		'--registry',
		'https://registry.example.com',
		'--no-pre-check',
		'--no-tests',
		'--no-build',
		'--no-publish',
	);

	await controller.waitForStderr(
		'The current HEAD branch is not the release target branch',
	);
});
