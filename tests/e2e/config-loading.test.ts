import { describe, expect, it } from 'vitest';
import { runPubmCli } from '../utils/cli.js';

describe('Config file loading', () => {
	it('pubm --help still works without config file', async () => {
		const { stdout, exitCode } = await runPubmCli(
			'node',
			{},
			'bin/cli.js',
			'--help',
		);
		expect(exitCode).toBe(0);
		expect(stdout).toContain('pubm');
	});
});
