import { test, describe } from 'vitest';
import { runPubmCli } from './utils/cli';

describe('CLI Basic Commands', () => {
	test('CLI help command shows usage', async () => {
		const { controller } = runPubmCli('--help');

		await controller.waitForStdout('pubm');
		await controller.waitForStdout('Usage:');
		await controller.waitForStdout('Options:');
	});

	test('CLI version command shows version', async () => {
		const { controller } = runPubmCli('--version');

		await controller.waitForStdout('pubm');
	});

	test('CLI -h alias shows help', async () => {
		const { controller } = runPubmCli('-h');

		await controller.waitForStdout('pubm');
		await controller.waitForStdout('Usage:');
	});

	test('CLI -v alias shows version', async () => {
		const { controller } = runPubmCli('-v');

		await controller.waitForStdout('pubm');
	});
});
