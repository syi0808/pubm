import { describe, expect, it } from 'vitest';
import { runPubmCli } from '../utils/cli.js';

describe('pubm --help', () => {
	it('should show help text with usage info', async () => {
		const { stdout } = await runPubmCli('node', {}, 'bin/cli.js', '--help');

		expect(stdout).toContain('Usage');
		expect(stdout).toContain('pubm');
	});

	it('should list the --test-script option', async () => {
		const { stdout } = await runPubmCli('node', {}, 'bin/cli.js', '--help');

		expect(stdout).toContain('--test-script');
	});

	it('should list the --build-script option', async () => {
		const { stdout } = await runPubmCli('node', {}, 'bin/cli.js', '--help');

		expect(stdout).toContain('--build-script');
	});

	it('should list the -p, --preview option', async () => {
		const { stdout } = await runPubmCli('node', {}, 'bin/cli.js', '--help');

		expect(stdout).toContain('-p, --preview');
	});

	it('should list the -b, --branch option', async () => {
		const { stdout } = await runPubmCli('node', {}, 'bin/cli.js', '--help');

		expect(stdout).toContain('-b, --branch');
	});

	it('should list the --publish-only option', async () => {
		const { stdout } = await runPubmCli('node', {}, 'bin/cli.js', '--help');

		expect(stdout).toContain('--publish-only');
	});

	it('should list the --registry option', async () => {
		const { stdout } = await runPubmCli('node', {}, 'bin/cli.js', '--help');

		expect(stdout).toContain('--registry');
	});

	it('should list the -t, --tag option', async () => {
		const { stdout } = await runPubmCli('node', {}, 'bin/cli.js', '--help');

		expect(stdout).toContain('-t, --tag');
	});

	it('should list the -c, --contents option', async () => {
		const { stdout } = await runPubmCli('node', {}, 'bin/cli.js', '--help');

		expect(stdout).toContain('-c, --contents');
	});

	it('should show version format info with semver types', async () => {
		const { stdout } = await runPubmCli('node', {}, 'bin/cli.js', '--help');

		expect(stdout).toContain('Version can be:');
		expect(stdout).toContain('major');
		expect(stdout).toContain('minor');
		expect(stdout).toContain('patch');
		expect(stdout).toContain('1.2.3');
	});

	it('should not show "(default: true)" in options', async () => {
		const { stdout } = await runPubmCli('node', {}, 'bin/cli.js', '--help');

		expect(stdout).not.toContain('(default: true)');
	});
});

describe('pubm --version', () => {
	it('should show the current version number', async () => {
		const { stdout } = await runPubmCli('node', {}, 'bin/cli.js', '--version');

		// Version should match a semver-like pattern
		expect(stdout.trim()).toMatch(/\d+\.\d+\.\d+/);
	});

	it('should show the version matching package.json', async () => {
		const { stdout } = await runPubmCli('node', {}, 'bin/cli.js', '--version');

		// The version from package.json is 0.0.5
		expect(stdout.trim()).toContain('0.0.5');
	});
});
