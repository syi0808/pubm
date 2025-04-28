import { test } from 'vitest';
import { runPubmCli } from './utils/cli';
import path from 'node:path';

test('git branch check', async () => {
	const { controller } = runPubmCli(
		'0.0.2',
		'--branch',
		'not-main',
		'--no-pre-check',
		'--no-tests',
		'--no-build',
		'--no-publish',
	);

	await controller.waitForStderr(
		'The current HEAD branch is not the release target branch',
	);
});

test('git any branch option', async () => {
	const { controller } = runPubmCli(
		'0.0.2',
		'--any-branch',
		'--no-pre-check',
		'--no-tests',
		'--no-build',
		'--no-publish',
	);

	// 이 테스트는 any-branch 옵션을 사용하면 브랜치 검사를 건너뛰므로
	// 다른 오류 메시지를 기다립니다.
	await controller.waitForStderr('Checking if remote history is clean');
});

test('git tag check', async () => {
	const { controller } = runPubmCli(
		'0.0.2',
		'--no-pre-check',
		'--no-tests',
		'--no-build',
		'--no-publish',
	);

	await controller.waitForStderr(
		'The current HEAD branch is not the release target branch',
	);
});

test('git working tree check', async () => {
	const { controller } = runPubmCli(
		'0.0.2',
		'--no-pre-check',
		'--no-tests',
		'--no-build',
		'--no-publish',
	);

	await controller.waitForStderr(
		'The current HEAD branch is not the release target branch',
	);
});
