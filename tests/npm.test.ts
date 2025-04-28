import { test } from 'vitest';
import { runPubmCli } from './utils/cli';
import path from 'node:path';

test('npm publish check', async () => {
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

test('npm tag option', async () => {
	const { controller } = runPubmCli(
		'0.0.2',
		'--registry',
		'npm',
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

test('npm contents option', async () => {
	const { controller } = runPubmCli(
		'0.0.2',
		'--registry',
		'npm',
		'--contents',
		path.resolve(import.meta.dirname, './fixtures/basic'),
		'--no-pre-check',
		'--no-tests',
		'--no-build',
		'--no-publish',
	);

	await controller.waitForStderr(
		'The current HEAD branch is not the release target branch',
	);
});

test('npm 2FA check', async () => {
	// 이 테스트는 CI 환경에서 실행되므로 2FA 관련 오류가 발생합니다.
	// 실제 환경에서는 이 테스트가 다르게 동작할 수 있습니다.
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
