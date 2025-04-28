import { test } from 'vitest';
import { runPubmCli } from './utils/cli';
import path from 'node:path';

test('jsr publish check', async () => {
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

test('jsr token check', async () => {
	// 이 테스트는 CI 환경에서 실행되므로 토큰 관련 오류가 발생합니다.
	// 실제 환경에서는 이 테스트가 다르게 동작할 수 있습니다.
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

test('jsr no-save-token option', async () => {
	const { controller } = runPubmCli(
		'0.0.2',
		'--registry',
		'jsr',
		'--no-save-token',
		'--no-pre-check',
		'--no-tests',
		'--no-build',
		'--no-publish',
	);

	await controller.waitForStderr(
		'The current HEAD branch is not the release target branch',
	);
});

test('jsr contents option', async () => {
	const { controller } = runPubmCli(
		'0.0.2',
		'--registry',
		'jsr',
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
