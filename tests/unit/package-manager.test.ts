import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { getPackageManager } from '../../src/utils/package-manager';

vi.mock('../../src/utils/package', () => ({
	findOutFile: vi.fn(),
}));

import { findOutFile } from '../../src/utils/package';

const mockedFindOutFile = vi.mocked(findOutFile);

describe('getPackageManager', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	test('returns npm when package-lock.json exists', async () => {
		mockedFindOutFile.mockImplementation(async (file) => {
			if (file === 'package-lock.json') return '/path/to/package-lock.json';
			return null;
		});

		const result = await getPackageManager();

		expect(result).toBe('npm');
	});

	test('returns npm when npm-shrinkwrap.json exists', async () => {
		mockedFindOutFile.mockImplementation(async (file) => {
			if (file === 'npm-shrinkwrap.json') return '/path/to/npm-shrinkwrap.json';
			return null;
		});

		const result = await getPackageManager();

		expect(result).toBe('npm');
	});

	test('returns pnpm when pnpm-lock.yaml exists', async () => {
		mockedFindOutFile.mockImplementation(async (file) => {
			if (file === 'pnpm-lock.yaml') return '/path/to/pnpm-lock.yaml';
			return null;
		});

		const result = await getPackageManager();

		expect(result).toBe('pnpm');
	});

	test('returns yarn when yarn.lock exists', async () => {
		mockedFindOutFile.mockImplementation(async (file) => {
			if (file === 'yarn.lock') return '/path/to/yarn.lock';
			return null;
		});

		const result = await getPackageManager();

		expect(result).toBe('yarn');
	});

	test('returns npm as default when no lock file exists', async () => {
		mockedFindOutFile.mockResolvedValue(null);

		const result = await getPackageManager();

		expect(result).toBe('npm');
	});

	test('prioritizes npm over pnpm and yarn', async () => {
		mockedFindOutFile.mockImplementation(async (file) => {
			if (file === 'package-lock.json') return '/path/to/package-lock.json';
			if (file === 'pnpm-lock.yaml') return '/path/to/pnpm-lock.yaml';
			if (file === 'yarn.lock') return '/path/to/yarn.lock';
			return null;
		});

		const result = await getPackageManager();

		expect(result).toBe('npm');
	});
});
