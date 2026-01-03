import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { notifyNewVersion } from '../../src/utils/notify-new-version';

vi.mock('tinyexec', () => ({
	exec: vi.fn(),
}));

vi.mock('../../src/utils/package', () => ({
	version: vi.fn(),
	findOutFile: vi.fn(),
	getPackageJson: vi.fn(),
	getJsrJson: vi.fn(),
}));

vi.mock('../../src/utils/package-name', () => ({
	getScopeAndName: vi.fn(),
}));

import { exec } from 'tinyexec';
import {
	version,
	findOutFile,
	getPackageJson,
	getJsrJson,
} from '../../src/utils/package';
import { getScopeAndName } from '../../src/utils/package-name';

const mockedExec = vi.mocked(exec);
const mockedVersion = vi.mocked(version);
const mockedFindOutFile = vi.mocked(findOutFile);
const mockedGetPackageJson = vi.mocked(getPackageJson);
const mockedGetJsrJson = vi.mocked(getJsrJson);
const mockedGetScopeAndName = vi.mocked(getScopeAndName);

describe('notifyNewVersion', () => {
	let consoleSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		vi.clearAllMocks();
		consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
		global.fetch = vi.fn();
	});

	afterEach(() => {
		consoleSpy.mockRestore();
	});

	test('does nothing when no package.json or jsr.json found', async () => {
		mockedVersion.mockResolvedValue('1.0.0');
		mockedFindOutFile.mockResolvedValue(null);

		await notifyNewVersion();

		expect(consoleSpy).not.toHaveBeenCalled();
	});

	test('shows npm update notification when new version available', async () => {
		mockedVersion.mockResolvedValue('1.0.0');
		mockedFindOutFile.mockImplementation(async (file) => {
			if (file === 'package.json') return '/path/to/package.json';
			return null;
		});
		mockedGetPackageJson.mockResolvedValue({
			name: 'test-package',
			version: '1.0.0',
		});
		mockedExec.mockResolvedValue({
			stdout: '2.0.0\n',
			stderr: '',
			exitCode: 0,
		} as never);

		await notifyNewVersion();

		expect(consoleSpy).toHaveBeenCalled();
		expect(consoleSpy.mock.calls[0][0]).toContain('Update available');
		expect(consoleSpy.mock.calls[0][0]).toContain('1.0.0');
		expect(consoleSpy.mock.calls[0][0]).toContain('2.0.0');
	});

	test('does not show notification when npm version is same', async () => {
		mockedVersion.mockResolvedValue('1.0.0');
		mockedFindOutFile.mockImplementation(async (file) => {
			if (file === 'package.json') return '/path/to/package.json';
			return null;
		});
		mockedGetPackageJson.mockResolvedValue({
			name: 'test-package',
			version: '1.0.0',
		});
		mockedExec.mockResolvedValue({
			stdout: '1.0.0\n',
			stderr: '',
			exitCode: 0,
		} as never);

		await notifyNewVersion();

		expect(consoleSpy).not.toHaveBeenCalled();
	});

	test('shows jsr update notification when new version available', async () => {
		mockedVersion.mockResolvedValue('1.0.0');
		mockedFindOutFile.mockImplementation(async (file) => {
			if (file === 'jsr.json') return '/path/to/jsr.json';
			return null;
		});
		mockedGetJsrJson.mockResolvedValue({
			name: '@scope/package',
			version: '1.0.0',
		});
		mockedGetScopeAndName.mockReturnValue(['scope', 'package']);
		(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
			json: () => Promise.resolve([{ version: '2.0.0' }]),
		});

		await notifyNewVersion();

		expect(consoleSpy).toHaveBeenCalled();
		expect(consoleSpy.mock.calls[0][0]).toContain('Update available');
	});

	test('handles npm check error gracefully', async () => {
		mockedVersion.mockResolvedValue('1.0.0');
		mockedFindOutFile.mockImplementation(async (file) => {
			if (file === 'package.json') return '/path/to/package.json';
			return null;
		});
		mockedGetPackageJson.mockRejectedValue(new Error('Network error'));

		await expect(notifyNewVersion()).resolves.not.toThrow();
	});

	test('handles jsr check error gracefully', async () => {
		mockedVersion.mockResolvedValue('1.0.0');
		mockedFindOutFile.mockImplementation(async (file) => {
			if (file === 'jsr.json') return '/path/to/jsr.json';
			return null;
		});
		mockedGetJsrJson.mockRejectedValue(new Error('Network error'));

		await expect(notifyNewVersion()).resolves.not.toThrow();
	});
});
