import { describe, expect, test, vi, beforeEach } from 'vitest';

vi.mock('../../src/options', () => ({
	resolveOptions: vi.fn((options) => ({
		...options,
		testScript: options.testScript ?? 'test',
		buildScript: options.buildScript ?? 'build',
		branch: options.branch ?? 'main',
		tag: options.tag ?? 'latest',
		registries: options.registries ?? ['npm', 'jsr'],
	})),
}));

vi.mock('../../src/tasks/runner', () => ({
	run: vi.fn().mockResolvedValue(undefined),
}));

import { pubm } from '../../src/index';
import { run } from '../../src/tasks/runner';
import { resolveOptions } from '../../src/options';

describe('pubm', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	test('calls resolveOptions with provided options', async () => {
		const options = {
			version: '1.0.0',
			testScript: 'test',
			buildScript: 'build',
		};

		await pubm(options);

		expect(resolveOptions).toHaveBeenCalledWith(options);
	});

	test('calls run with resolved options', async () => {
		const options = {
			version: '2.0.0',
		};

		await pubm(options);

		expect(run).toHaveBeenCalled();
	});

	test('handles custom registries', async () => {
		const options = {
			version: '1.0.0',
			registries: ['npm'],
		};

		await pubm(options);

		expect(resolveOptions).toHaveBeenCalledWith(options);
		expect(run).toHaveBeenCalled();
	});

	test('handles skip options', async () => {
		const options = {
			version: '1.0.0',
			skipTests: true,
			skipBuild: true,
			skipPublish: true,
		};

		await pubm(options);

		expect(resolveOptions).toHaveBeenCalledWith(options);
		expect(run).toHaveBeenCalled();
	});

	test('handles preview mode', async () => {
		const options = {
			version: '1.0.0',
			preview: true,
		};

		await pubm(options);

		expect(resolveOptions).toHaveBeenCalledWith(options);
		expect(run).toHaveBeenCalled();
	});
});
