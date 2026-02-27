import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('tinyexec', () => ({
	exec: vi.fn(),
}));

vi.mock('../../../src/utils/package-name.js', () => ({
	isValidPackageName: vi.fn(),
}));

vi.mock('../../../src/utils/package.js', () => ({
	getPackageJson: vi.fn(),
}));

import { exec } from 'tinyexec';
import { NpmRegistry, npmRegistry } from '../../../src/registry/npm.js';
import { isValidPackageName } from '../../../src/utils/package-name.js';
import { getPackageJson } from '../../../src/utils/package.js';

const mockedExec = vi.mocked(exec);
const mockedIsValidPackageName = vi.mocked(isValidPackageName);
const mockedGetPackageJson = vi.mocked(getPackageJson);

let mockedFetch: ReturnType<typeof vi.fn>;
let registry: NpmRegistry;

beforeEach(() => {
	vi.clearAllMocks();
	mockedFetch = vi.fn();
	vi.stubGlobal('fetch', mockedFetch);
	registry = new NpmRegistry('my-package');
});

function mockStdout(stdout: string) {
	mockedExec.mockResolvedValue({ stdout, stderr: '' } as any);
}

function mockStderr(stderr: string) {
	mockedExec.mockResolvedValue({ stdout: '', stderr } as any);
}

describe('NpmRegistry', () => {
	it('has default registry url', () => {
		expect(registry.registry).toBe('https://registry.npmjs.org');
	});

	describe('npm(args)', () => {
		it('calls exec with npm and returns stdout', async () => {
			mockStdout('help output');

			// npm() is protected, test indirectly via isInstalled
			const result = await registry.isInstalled();

			expect(mockedExec).toHaveBeenCalledWith('npm', ['--help']);
			expect(result).toBe(true);
		});

		it('throws stderr when stderr is non-empty', async () => {
			mockStderr('fatal error');

			// npm() throws stderr, which bubbles up through version() catch as NpmError
			await expect(registry.version()).rejects.toThrow();
		});
	});

	describe('isInstalled()', () => {
		it('returns true when npm --help succeeds', async () => {
			mockStdout('help output');

			const result = await registry.isInstalled();

			expect(mockedExec).toHaveBeenCalledWith('npm', ['--help']);
			expect(result).toBe(true);
		});

		it('returns false when npm --help fails', async () => {
			mockedExec.mockRejectedValue(new Error('not found'));

			const result = await registry.isInstalled();

			expect(result).toBe(false);
		});
	});

	describe('installGlobally(packageName)', () => {
		it('returns true on success', async () => {
			mockStdout('added 1 package');

			const result = await registry.installGlobally('some-pkg');

			expect(mockedExec).toHaveBeenCalledWith('npm', [
				'install',
				'-g',
				'some-pkg',
			]);
			expect(result).toBe(true);
		});

		it('throws NpmError on failure', async () => {
			mockStderr('ERR! code EACCES');

			await expect(registry.installGlobally('some-pkg')).rejects.toThrow(
				'Failed to run `npm install -g some-pkg`',
			);
		});
	});

	describe('isPublished()', () => {
		it('returns true when registry responds with 200', async () => {
			mockedFetch.mockResolvedValue({ status: 200 });

			const result = await registry.isPublished();

			expect(mockedFetch).toHaveBeenCalledWith(
				'https://registry.npmjs.org/my-package',
			);
			expect(result).toBe(true);
		});

		it('returns false when registry responds with 404', async () => {
			mockedFetch.mockResolvedValue({ status: 404 });

			const result = await registry.isPublished();

			expect(result).toBe(false);
		});

		it('throws NpmError when fetch fails', async () => {
			mockedFetch.mockRejectedValue(new Error('network error'));

			await expect(registry.isPublished()).rejects.toThrow(
				'Failed to fetch `https://registry.npmjs.org/my-package`',
			);
		});
	});

	describe('userName()', () => {
		it('returns trimmed username', async () => {
			mockStdout('testuser\n');

			const result = await registry.userName();

			expect(mockedExec).toHaveBeenCalledWith('npm', ['whoami']);
			expect(result).toBe('testuser');
		});

		it('throws NpmError on failure', async () => {
			mockStderr('ENEEDAUTH');

			await expect(registry.userName()).rejects.toThrow(
				'Failed to run `npm whoami`',
			);
		});
	});

	describe('isLoggedIn()', () => {
		it('returns true when whoami succeeds', async () => {
			mockStdout('testuser');

			const result = await registry.isLoggedIn();

			expect(mockedExec).toHaveBeenCalledWith('npm', ['whoami']);
			expect(result).toBe(true);
		});

		it('returns false when error includes ENEEDAUTH', async () => {
			mockStderr('ENEEDAUTH');

			const result = await registry.isLoggedIn();

			expect(result).toBe(false);
		});

		it('throws NpmError for other errors', async () => {
			mockStderr('ECONNREFUSED');

			await expect(registry.isLoggedIn()).rejects.toThrow(
				'Failed to run `npm whoami`',
			);
		});
	});

	describe('collaborators()', () => {
		it('returns parsed collaborators JSON', async () => {
			const data = { testuser: 'read-write' };
			mockStdout(JSON.stringify(data));

			const result = await registry.collaborators();

			expect(mockedExec).toHaveBeenCalledWith('npm', [
				'access',
				'list',
				'collaborators',
				'my-package',
				'--json',
			]);
			expect(result).toEqual(data);
		});

		it('throws NpmError on failure', async () => {
			mockStderr('ERR!');

			await expect(registry.collaborators()).rejects.toThrow(
				'Failed to run `npm access list collaborators my-package --json`',
			);
		});
	});

	describe('hasPermission()', () => {
		it('returns true when user has write permission', async () => {
			mockedExec
				.mockResolvedValueOnce({ stdout: 'testuser\n', stderr: '' } as any)
				.mockResolvedValueOnce({
					stdout: JSON.stringify({ testuser: 'read-write' }),
					stderr: '',
				} as any);

			const result = await registry.hasPermission();

			expect(result).toBe(true);
		});

		it('returns false when user does not have write permission', async () => {
			mockedExec
				.mockResolvedValueOnce({ stdout: 'testuser\n', stderr: '' } as any)
				.mockResolvedValueOnce({
					stdout: JSON.stringify({ testuser: 'read-only' }),
					stderr: '',
				} as any);

			const result = await registry.hasPermission();

			expect(result).toBe(false);
		});

		it('returns false when user is not in collaborators', async () => {
			mockedExec
				.mockResolvedValueOnce({ stdout: 'testuser\n', stderr: '' } as any)
				.mockResolvedValueOnce({
					stdout: JSON.stringify({ otheruser: 'read-write' }),
					stderr: '',
				} as any);

			const result = await registry.hasPermission();

			expect(result).toBe(false);
		});
	});

	describe('distTags()', () => {
		it('returns array of dist-tag names', async () => {
			const tags = { latest: '1.0.0', beta: '2.0.0-beta.1' };
			mockStdout(JSON.stringify(tags));

			const result = await registry.distTags();

			expect(mockedExec).toHaveBeenCalledWith('npm', [
				'view',
				'my-package',
				'dist-tags',
				'--json',
			]);
			expect(result).toEqual(['latest', 'beta']);
		});

		it('throws NpmError on failure', async () => {
			mockStderr('ERR! 404');

			await expect(registry.distTags()).rejects.toThrow(
				'Failed to run `npm view my-package dist-tags --json`',
			);
		});
	});

	describe('version()', () => {
		it('returns npm version string', async () => {
			mockStdout('10.2.0');

			const result = await registry.version();

			expect(mockedExec).toHaveBeenCalledWith('npm', ['--version']);
			expect(result).toBe('10.2.0');
		});

		it('throws on failure (no await in source, so raw stderr escapes catch)', async () => {
			mockStderr('some error');

			await expect(registry.version()).rejects.toBe('some error');
		});
	});

	describe('ping()', () => {
		it('returns true when ping succeeds', async () => {
			mockedExec.mockResolvedValue({ stdout: '', stderr: '' } as any);

			const result = await registry.ping();

			expect(mockedExec).toHaveBeenCalledWith('npm', ['ping'], {
				throwOnError: true,
			});
			expect(result).toBe(true);
		});

		it('throws NpmError when ping fails', async () => {
			mockedExec.mockRejectedValue(new Error('timeout'));

			await expect(registry.ping()).rejects.toThrow('Failed to run `npm ping`');
		});
	});

	describe('publishProvenance()', () => {
		it('returns true on successful publish', async () => {
			mockStdout('+ my-package@1.0.0');

			const result = await registry.publishProvenance();

			expect(mockedExec).toHaveBeenCalledWith('npm', [
				'publish',
				'--provenance',
				'--access',
				'public',
			]);
			expect(result).toBe(true);
		});

		it('returns false when error includes EOTP', async () => {
			mockStderr('EOTP');

			const result = await registry.publishProvenance();

			expect(result).toBe(false);
		});

		it('returns true when publish succeeds without EOTP', async () => {
			mockStdout('published');

			const result = await registry.publishProvenance();

			expect(result).toBe(true);
		});
	});

	describe('publish()', () => {
		it('returns true on successful publish without OTP', async () => {
			mockStdout('+ my-package@1.0.0');

			const result = await registry.publish();

			expect(mockedExec).toHaveBeenCalledWith('npm', ['publish']);
			expect(result).toBe(true);
		});

		it('returns true on successful publish with OTP', async () => {
			mockStdout('+ my-package@1.0.0');

			const result = await registry.publish('123456');

			expect(mockedExec).toHaveBeenCalledWith('npm', [
				'publish',
				'--otp',
				'123456',
			]);
			expect(result).toBe(true);
		});

		it('returns false when error includes EOTP (without otp)', async () => {
			mockStderr('EOTP');

			const result = await registry.publish();

			expect(result).toBe(false);
		});

		it('returns false when error includes EOTP (with otp)', async () => {
			mockStderr('EOTP');

			const result = await registry.publish('123456');

			expect(result).toBe(false);
		});
	});

	describe('isPackageNameAvaliable()', () => {
		it('returns true when package name is valid', async () => {
			mockedIsValidPackageName.mockReturnValue(true);

			const result = await registry.isPackageNameAvaliable();

			expect(mockedIsValidPackageName).toHaveBeenCalledWith('my-package');
			expect(result).toBe(true);
		});

		it('returns false when package name is invalid', async () => {
			mockedIsValidPackageName.mockReturnValue(false);

			const result = await registry.isPackageNameAvaliable();

			expect(result).toBe(false);
		});
	});
});

describe('npmRegistry()', () => {
	it('creates NpmRegistry from package.json name', async () => {
		mockedGetPackageJson.mockResolvedValue({
			name: 'my-lib',
			version: '1.0.0',
		} as any);

		const result = await npmRegistry();

		expect(mockedGetPackageJson).toHaveBeenCalled();
		expect(result).toBeInstanceOf(NpmRegistry);
		expect(result.packageName).toBe('my-lib');
	});
});
