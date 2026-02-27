import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('tinyexec', () => ({
	exec: vi.fn(),
}));

vi.mock('../../../src/utils/package.js', () => ({
	version: vi.fn(),
	findOutFile: vi.fn(),
	getPackageJson: vi.fn(),
	getJsrJson: vi.fn(),
}));

vi.mock('../../../src/utils/package-name.js', () => ({
	getScopeAndName: vi.fn(),
}));

import { exec } from 'tinyexec';
import { notifyNewVersion } from '../../../src/utils/notify-new-version.js';
import { getScopeAndName } from '../../../src/utils/package-name.js';
import {
	findOutFile,
	getJsrJson,
	getPackageJson,
	version,
} from '../../../src/utils/package.js';

const mockedExec = vi.mocked(exec);
const mockedVersion = vi.mocked(version);
const mockedFindOutFile = vi.mocked(findOutFile);
const mockedGetPackageJson = vi.mocked(getPackageJson);
const mockedGetJsrJson = vi.mocked(getJsrJson);
const mockedGetScopeAndName = vi.mocked(getScopeAndName);

let consoleSpy: ReturnType<typeof vi.spyOn>;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
	vi.clearAllMocks();

	consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
	fetchMock = vi.fn();
	vi.stubGlobal('fetch', fetchMock);

	// Defaults: no package.json or jsr.json found
	mockedVersion.mockResolvedValue('1.0.0');
	mockedFindOutFile.mockResolvedValue(null);
});

describe('notifyNewVersion', () => {
	describe('npm registry check', () => {
		it('logs update when npm has a newer version', async () => {
			mockedFindOutFile.mockImplementation(async (file) => {
				if (file === 'package.json') return '/path/to/package.json';
				return null;
			});
			mockedGetPackageJson.mockResolvedValue({
				name: 'pubm',
			} as any);
			mockedExec.mockResolvedValue({
				stdout: '2.0.0\n',
				stderr: '',
			} as any);

			await notifyNewVersion();

			expect(consoleSpy).toHaveBeenCalledOnce();
			expect(consoleSpy.mock.calls[0][0]).toContain('Update available!');
			expect(consoleSpy.mock.calls[0][0]).toContain('pubm');
		});

		it('does not log when npm version matches current version', async () => {
			mockedFindOutFile.mockImplementation(async (file) => {
				if (file === 'package.json') return '/path/to/package.json';
				return null;
			});
			mockedGetPackageJson.mockResolvedValue({
				name: 'pubm',
			} as any);
			mockedExec.mockResolvedValue({
				stdout: '1.0.0',
				stderr: '',
			} as any);

			await notifyNewVersion();

			expect(consoleSpy).not.toHaveBeenCalled();
		});

		it('returns early when package.json is not found', async () => {
			mockedFindOutFile.mockResolvedValue(null);

			await notifyNewVersion();

			expect(mockedGetPackageJson).not.toHaveBeenCalled();
			expect(mockedExec).not.toHaveBeenCalled();
			expect(consoleSpy).not.toHaveBeenCalled();
		});

		it('swallows errors from npm info silently', async () => {
			mockedFindOutFile.mockImplementation(async (file) => {
				if (file === 'package.json') return '/path/to/package.json';
				return null;
			});
			mockedGetPackageJson.mockResolvedValue({
				name: 'pubm',
			} as any);
			mockedExec.mockRejectedValue(new Error('npm info failed'));

			await expect(notifyNewVersion()).resolves.toBeUndefined();
			expect(consoleSpy).not.toHaveBeenCalled();
		});

		it('swallows errors from getPackageJson silently', async () => {
			mockedFindOutFile.mockImplementation(async (file) => {
				if (file === 'package.json') return '/path/to/package.json';
				return null;
			});
			mockedGetPackageJson.mockRejectedValue(
				new Error('failed to read package.json'),
			);

			await expect(notifyNewVersion()).resolves.toBeUndefined();
			expect(consoleSpy).not.toHaveBeenCalled();
		});
	});

	describe('jsr registry check', () => {
		it('logs update when jsr has a newer version', async () => {
			mockedFindOutFile.mockImplementation(async (file) => {
				if (file === 'jsr.json') return '/path/to/jsr.json';
				return null;
			});
			mockedGetJsrJson.mockResolvedValue({
				name: '@scope/pubm',
			} as any);
			mockedGetScopeAndName.mockReturnValue(['scope', 'pubm']);
			fetchMock.mockResolvedValue({
				json: async () => [{ version: '2.0.0' }],
			});

			await notifyNewVersion();

			expect(fetchMock).toHaveBeenCalledWith(
				'https://api.jsr.io/scopes/scope/packages/pubm/versions',
			);
			expect(consoleSpy).toHaveBeenCalledOnce();
			expect(consoleSpy.mock.calls[0][0]).toContain('Update available!');
			expect(consoleSpy.mock.calls[0][0]).toContain('@scope/pubm');
		});

		it('does not log when jsr version matches current version', async () => {
			mockedFindOutFile.mockImplementation(async (file) => {
				if (file === 'jsr.json') return '/path/to/jsr.json';
				return null;
			});
			mockedGetJsrJson.mockResolvedValue({
				name: '@scope/pubm',
			} as any);
			mockedGetScopeAndName.mockReturnValue(['scope', 'pubm']);
			fetchMock.mockResolvedValue({
				json: async () => [{ version: '1.0.0' }],
			});

			await notifyNewVersion();

			expect(consoleSpy).not.toHaveBeenCalled();
		});

		it('does not log when jsr returns empty versions array', async () => {
			mockedFindOutFile.mockImplementation(async (file) => {
				if (file === 'jsr.json') return '/path/to/jsr.json';
				return null;
			});
			mockedGetJsrJson.mockResolvedValue({
				name: '@scope/pubm',
			} as any);
			mockedGetScopeAndName.mockReturnValue(['scope', 'pubm']);
			fetchMock.mockResolvedValue({
				json: async () => [],
			});

			await notifyNewVersion();

			expect(consoleSpy).not.toHaveBeenCalled();
		});

		it('returns early when jsr.json is not found', async () => {
			mockedFindOutFile.mockResolvedValue(null);

			await notifyNewVersion();

			expect(mockedGetJsrJson).not.toHaveBeenCalled();
			expect(fetchMock).not.toHaveBeenCalled();
			expect(consoleSpy).not.toHaveBeenCalled();
		});

		it('swallows errors from fetch silently', async () => {
			mockedFindOutFile.mockImplementation(async (file) => {
				if (file === 'jsr.json') return '/path/to/jsr.json';
				return null;
			});
			mockedGetJsrJson.mockResolvedValue({
				name: '@scope/pubm',
			} as any);
			mockedGetScopeAndName.mockReturnValue(['scope', 'pubm']);
			fetchMock.mockRejectedValue(new Error('network error'));

			await expect(notifyNewVersion()).resolves.toBeUndefined();
			expect(consoleSpy).not.toHaveBeenCalled();
		});

		it('swallows errors from getJsrJson silently', async () => {
			mockedFindOutFile.mockImplementation(async (file) => {
				if (file === 'jsr.json') return '/path/to/jsr.json';
				return null;
			});
			mockedGetJsrJson.mockRejectedValue(new Error('failed to read jsr.json'));

			await expect(notifyNewVersion()).resolves.toBeUndefined();
			expect(consoleSpy).not.toHaveBeenCalled();
		});
	});

	describe('concurrent checks', () => {
		it('checks both npm and jsr concurrently', async () => {
			mockedFindOutFile.mockImplementation(async (file) => {
				if (file === 'package.json') return '/path/to/package.json';
				if (file === 'jsr.json') return '/path/to/jsr.json';
				return null;
			});
			mockedGetPackageJson.mockResolvedValue({
				name: 'pubm',
			} as any);
			mockedGetJsrJson.mockResolvedValue({
				name: '@scope/pubm',
			} as any);
			mockedGetScopeAndName.mockReturnValue(['scope', 'pubm']);
			mockedExec.mockResolvedValue({
				stdout: '2.0.0\n',
				stderr: '',
			} as any);
			fetchMock.mockResolvedValue({
				json: async () => [{ version: '2.0.0' }],
			});

			await notifyNewVersion();

			expect(mockedGetPackageJson).toHaveBeenCalledOnce();
			expect(mockedGetJsrJson).toHaveBeenCalledOnce();
			expect(consoleSpy).toHaveBeenCalledTimes(2);
		});

		it('npm failure does not prevent jsr check', async () => {
			mockedFindOutFile.mockImplementation(async (file) => {
				if (file === 'package.json') return '/path/to/package.json';
				if (file === 'jsr.json') return '/path/to/jsr.json';
				return null;
			});
			mockedGetPackageJson.mockRejectedValue(new Error('npm error'));
			mockedGetJsrJson.mockResolvedValue({
				name: '@scope/pubm',
			} as any);
			mockedGetScopeAndName.mockReturnValue(['scope', 'pubm']);
			fetchMock.mockResolvedValue({
				json: async () => [{ version: '2.0.0' }],
			});

			await notifyNewVersion();

			expect(consoleSpy).toHaveBeenCalledOnce();
			expect(consoleSpy.mock.calls[0][0]).toContain('@scope/pubm');
		});

		it('jsr failure does not prevent npm check', async () => {
			mockedFindOutFile.mockImplementation(async (file) => {
				if (file === 'package.json') return '/path/to/package.json';
				if (file === 'jsr.json') return '/path/to/jsr.json';
				return null;
			});
			mockedGetPackageJson.mockResolvedValue({
				name: 'pubm',
			} as any);
			mockedExec.mockResolvedValue({
				stdout: '2.0.0\n',
				stderr: '',
			} as any);
			mockedGetJsrJson.mockRejectedValue(new Error('jsr error'));

			await notifyNewVersion();

			expect(consoleSpy).toHaveBeenCalledOnce();
			expect(consoleSpy.mock.calls[0][0]).toContain('pubm');
		});
	});
});
