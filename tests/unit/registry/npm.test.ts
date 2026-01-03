import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { NpmRegistry, npmRegistry } from '../../../src/registry/npm';

vi.mock('tinyexec', () => ({
	exec: vi.fn(),
}));

vi.mock('../../../src/utils/package', () => ({
	getPackageJson: vi.fn().mockResolvedValue({
		name: 'test-package',
		version: '1.0.0',
	}),
}));

import { exec } from 'tinyexec';

const mockedExec = vi.mocked(exec);

describe('NpmRegistry', () => {
	let registry: NpmRegistry;

	beforeEach(() => {
		vi.clearAllMocks();
		registry = new NpmRegistry('test-package');
		global.fetch = vi.fn();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	test('has correct default registry', () => {
		expect(registry.registry).toBe('https://registry.npmjs.org');
	});

	describe('isInstalled', () => {
		test('returns true when npm is available', async () => {
			mockedExec.mockResolvedValue({
				stdout: 'npm help',
				stderr: '',
				exitCode: 0,
			} as never);

			expect(await registry.isInstalled()).toBe(true);
		});

		test('returns false when npm is not available', async () => {
			mockedExec.mockRejectedValue(new Error('not found'));

			expect(await registry.isInstalled()).toBe(false);
		});
	});

	describe('isPublished', () => {
		test('returns true when package exists', async () => {
			(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
				status: 200,
			});

			expect(await registry.isPublished()).toBe(true);
		});

		test('returns false when package does not exist', async () => {
			(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
				status: 404,
			});

			expect(await registry.isPublished()).toBe(false);
		});

		test('throws error on network failure', async () => {
			(global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
				new Error('Network error'),
			);

			await expect(registry.isPublished()).rejects.toThrow();
		});
	});

	describe('userName', () => {
		test('returns npm username', async () => {
			mockedExec.mockResolvedValue({
				stdout: 'testuser\n',
				stderr: '',
				exitCode: 0,
			} as never);

			expect(await registry.userName()).toBe('testuser');
		});

		test('throws error on failure', async () => {
			mockedExec.mockResolvedValue({
				stdout: '',
				stderr: 'error',
				exitCode: 1,
			} as never);

			await expect(registry.userName()).rejects.toThrow();
		});
	});

	describe('isLoggedIn', () => {
		test('returns true when logged in', async () => {
			mockedExec.mockResolvedValue({
				stdout: 'testuser',
				stderr: '',
				exitCode: 0,
			} as never);

			expect(await registry.isLoggedIn()).toBe(true);
		});

		test('returns false when ENEEDAUTH error', async () => {
			mockedExec.mockResolvedValue({
				stdout: '',
				stderr: 'ENEEDAUTH',
				exitCode: 1,
			} as never);

			expect(await registry.isLoggedIn()).toBe(false);
		});
	});

	describe('collaborators', () => {
		test('returns collaborators list', async () => {
			mockedExec.mockResolvedValue({
				stdout: '{"user1": "read-write", "user2": "read-only"}',
				stderr: '',
				exitCode: 0,
			} as never);

			const result = await registry.collaborators();

			expect(result).toEqual({
				user1: 'read-write',
				user2: 'read-only',
			});
		});
	});

	describe('hasPermission', () => {
		test('returns true when user has write permission', async () => {
			mockedExec
				.mockResolvedValueOnce({
					stdout: 'testuser\n',
					stderr: '',
					exitCode: 0,
				} as never)
				.mockResolvedValueOnce({
					stdout: '{"testuser": "read-write"}',
					stderr: '',
					exitCode: 0,
				} as never);

			expect(await registry.hasPermission()).toBe(true);
		});

		test('returns false when user does not have write permission', async () => {
			mockedExec
				.mockResolvedValueOnce({
					stdout: 'testuser\n',
					stderr: '',
					exitCode: 0,
				} as never)
				.mockResolvedValueOnce({
					stdout: '{"testuser": "read-only"}',
					stderr: '',
					exitCode: 0,
				} as never);

			expect(await registry.hasPermission()).toBe(false);
		});
	});

	describe('distTags', () => {
		test('returns dist tags', async () => {
			mockedExec.mockResolvedValue({
				stdout: '{"latest": "1.0.0", "beta": "2.0.0-beta.1"}',
				stderr: '',
				exitCode: 0,
			} as never);

			const result = await registry.distTags();

			expect(result).toContain('latest');
			expect(result).toContain('beta');
		});
	});

	describe('version', () => {
		test('returns npm version', async () => {
			mockedExec.mockResolvedValue({
				stdout: '10.0.0',
				stderr: '',
				exitCode: 0,
			} as never);

			expect(await registry.version()).toBe('10.0.0');
		});
	});

	describe('ping', () => {
		test('returns true on successful ping', async () => {
			mockedExec.mockResolvedValue({
				stdout: 'Ping success',
				stderr: '',
				exitCode: 0,
			} as never);

			expect(await registry.ping()).toBe(true);
		});

		test('throws error on ping failure', async () => {
			mockedExec.mockRejectedValue(new Error('ping failed'));

			await expect(registry.ping()).rejects.toThrow();
		});
	});

	describe('publish', () => {
		test('returns true on successful publish', async () => {
			mockedExec.mockResolvedValue({
				stdout: 'Published',
				stderr: '',
				exitCode: 0,
			} as never);

			expect(await registry.publish()).toBe(true);
		});

		test('returns false when OTP required', async () => {
			mockedExec.mockResolvedValue({
				stdout: '',
				stderr: 'EOTP',
				exitCode: 1,
			} as never);

			expect(await registry.publish()).toBe(false);
		});

		test('accepts OTP parameter', async () => {
			mockedExec.mockResolvedValue({
				stdout: 'Published',
				stderr: '',
				exitCode: 0,
			} as never);

			expect(await registry.publish('123456')).toBe(true);
			expect(mockedExec).toHaveBeenCalledWith('npm', [
				'publish',
				'--otp',
				'123456',
			]);
		});
	});

	describe('publishProvenance', () => {
		test('returns true on successful publish with provenance', async () => {
			mockedExec.mockResolvedValue({
				stdout: 'Published',
				stderr: '',
				exitCode: 0,
			} as never);

			expect(await registry.publishProvenance()).toBe(true);
		});

		test('returns false when OTP required', async () => {
			mockedExec.mockResolvedValue({
				stdout: '',
				stderr: 'EOTP',
				exitCode: 1,
			} as never);

			expect(await registry.publishProvenance()).toBe(false);
		});
	});

	describe('isPackageNameAvaliable', () => {
		test('returns true for valid package name', async () => {
			expect(await registry.isPackageNameAvaliable()).toBe(true);
		});

		test('returns false for invalid package name', async () => {
			const invalidRegistry = new NpmRegistry('Invalid-Package');

			expect(await invalidRegistry.isPackageNameAvaliable()).toBe(false);
		});
	});

	describe('installGlobally', () => {
		test('returns true on successful install', async () => {
			mockedExec.mockResolvedValue({
				stdout: 'installed',
				stderr: '',
				exitCode: 0,
			} as never);

			expect(await registry.installGlobally('some-package')).toBe(true);
		});

		test('throws error on install failure', async () => {
			mockedExec.mockResolvedValue({
				stdout: '',
				stderr: 'install failed',
				exitCode: 1,
			} as never);

			await expect(registry.installGlobally('some-package')).rejects.toThrow();
		});
	});

	describe('error handling', () => {
		test('collaborators throws error on failure', async () => {
			mockedExec.mockResolvedValue({
				stdout: '',
				stderr: 'error',
				exitCode: 1,
			} as never);

			await expect(registry.collaborators()).rejects.toThrow();
		});

		test('distTags throws error on failure', async () => {
			mockedExec.mockResolvedValue({
				stdout: '',
				stderr: 'error',
				exitCode: 1,
			} as never);

			await expect(registry.distTags()).rejects.toThrow();
		});

		test('version throws error on failure', async () => {
			mockedExec.mockResolvedValue({
				stdout: '',
				stderr: 'error',
				exitCode: 1,
			} as never);

			await expect(registry.version()).rejects.toThrow();
		});

		test('isLoggedIn throws error on non-ENEEDAUTH failure', async () => {
			mockedExec.mockResolvedValue({
				stdout: '',
				stderr: 'other error',
				exitCode: 1,
			} as never);

			await expect(registry.isLoggedIn()).rejects.toThrow();
		});
	});
});

describe('npmRegistry factory', () => {
	test('creates NpmRegistry instance', async () => {
		const { getPackageJson } = await import('../../../src/utils/package');
		vi.mocked(getPackageJson).mockResolvedValue({
			name: 'test-package',
			version: '1.0.0',
		});

		const registry = await npmRegistry();

		expect(registry).toBeInstanceOf(NpmRegistry);
		expect(registry.packageName).toBe('test-package');
	});
});
