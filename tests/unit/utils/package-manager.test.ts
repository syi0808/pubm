import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/utils/package.js', () => ({
	findOutFile: vi.fn(),
}));

import { getPackageManager } from '../../../src/utils/package-manager.js';
import { findOutFile } from '../../../src/utils/package.js';

const mockFindOutFile = vi.mocked(findOutFile);

describe('getPackageManager', () => {
	beforeEach(() => {
		mockFindOutFile.mockReset();
	});

	it('returns "npm" when package-lock.json is found', async () => {
		mockFindOutFile.mockImplementation(async (file) => {
			if (file === 'package-lock.json') return '/project/package-lock.json';
			return null;
		});

		const result = await getPackageManager();
		expect(result).toBe('npm');
	});

	it('returns "npm" when npm-shrinkwrap.json is found', async () => {
		mockFindOutFile.mockImplementation(async (file) => {
			if (file === 'npm-shrinkwrap.json') return '/project/npm-shrinkwrap.json';
			return null;
		});

		const result = await getPackageManager();
		expect(result).toBe('npm');
	});

	it('returns "pnpm" when pnpm-lock.yaml is found', async () => {
		mockFindOutFile.mockImplementation(async (file) => {
			if (file === 'pnpm-lock.yaml') return '/project/pnpm-lock.yaml';
			return null;
		});

		const result = await getPackageManager();
		expect(result).toBe('pnpm');
	});

	it('returns "yarn" when yarn.lock is found', async () => {
		mockFindOutFile.mockImplementation(async (file) => {
			if (file === 'yarn.lock') return '/project/yarn.lock';
			return null;
		});

		const result = await getPackageManager();
		expect(result).toBe('yarn');
	});

	it('returns "npm" as fallback when no lock file is found', async () => {
		mockFindOutFile.mockResolvedValue(null);

		const result = await getPackageManager();
		expect(result).toBe('npm');
	});

	it('checks npm lock files before pnpm and yarn due to object iteration order', async () => {
		// When both npm and pnpm lock files exist, npm should win
		// because it comes first in the lockFile record
		mockFindOutFile.mockImplementation(async (file) => {
			if (file === 'package-lock.json') return '/project/package-lock.json';
			if (file === 'pnpm-lock.yaml') return '/project/pnpm-lock.yaml';
			return null;
		});

		const result = await getPackageManager();
		expect(result).toBe('npm');
	});

	it('checks pnpm before yarn when npm lock files are absent', async () => {
		mockFindOutFile.mockImplementation(async (file) => {
			if (file === 'pnpm-lock.yaml') return '/project/pnpm-lock.yaml';
			if (file === 'yarn.lock') return '/project/yarn.lock';
			return null;
		});

		const result = await getPackageManager();
		expect(result).toBe('pnpm');
	});

	it('calls findOutFile with the correct lock file names', async () => {
		mockFindOutFile.mockResolvedValue(null);

		await getPackageManager();

		expect(mockFindOutFile).toHaveBeenCalledWith('package-lock.json');
		expect(mockFindOutFile).toHaveBeenCalledWith('npm-shrinkwrap.json');
		expect(mockFindOutFile).toHaveBeenCalledWith('pnpm-lock.yaml');
		expect(mockFindOutFile).toHaveBeenCalledWith('yarn.lock');
	});
});
