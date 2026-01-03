import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { JsrRegisry, JsrClient, jsrRegistry } from '../../../src/registry/jsr';

vi.mock('tinyexec', () => ({
	exec: vi.fn(),
}));

vi.mock('../../../src/utils/package', () => ({
	getJsrJson: vi.fn().mockResolvedValue({
		name: '@test/package',
		version: '1.0.0',
	}),
	version: vi.fn().mockResolvedValue('1.0.0'),
}));

vi.mock('../../../src/utils/db', () => ({
	Db: vi.fn().mockImplementation(() => ({
		get: vi.fn().mockReturnValue('test-token'),
	})),
}));

import { exec } from 'tinyexec';

const mockedExec = vi.mocked(exec);

describe('JsrRegisry', () => {
	let registry: JsrRegisry;

	beforeEach(() => {
		vi.clearAllMocks();
		registry = new JsrRegisry('@test/package');
		global.fetch = vi.fn();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	test('has correct default registry', () => {
		expect(registry.registry).toBe('https://jsr.io');
	});

	test('has client instance', () => {
		expect(registry.client).toBeInstanceOf(JsrClient);
	});

	describe('isInstalled', () => {
		test('returns true when jsr is available', async () => {
			mockedExec.mockResolvedValue({
				stdout: 'jsr help',
				stderr: '',
				exitCode: 0,
			} as never);

			expect(await registry.isInstalled()).toBe(true);
		});

		test('returns false when jsr is not available', async () => {
			mockedExec.mockRejectedValue(new Error('not found'));

			expect(await registry.isInstalled()).toBe(false);
		});
	});

	describe('distTags', () => {
		test('returns empty array (jsr does not support dist tags)', async () => {
			expect(await registry.distTags()).toEqual([]);
		});
	});

	describe('ping', () => {
		test('returns true on successful ping', async () => {
			mockedExec.mockResolvedValue({
				stdout: '1 packets transmitted, 1 packets received',
				stderr: '',
				exitCode: 0,
			} as never);

			expect(await registry.ping()).toBe(true);
		});

		test('throws error on ping failure', async () => {
			mockedExec.mockResolvedValue({
				stdout: '',
				stderr: 'ping failed',
				exitCode: 1,
			} as never);

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

		test('throws error on publish failure', async () => {
			mockedExec.mockRejectedValue(new Error('publish failed'));

			await expect(registry.publish()).rejects.toThrow();
		});
	});

	describe('version', () => {
		test('returns jsr version', async () => {
			mockedExec.mockResolvedValue({
				stdout: '0.13.0',
				stderr: '',
				exitCode: 0,
			} as never);

			expect(await registry.version()).toBe('0.13.0');
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

	describe('hasPermission', () => {
		test('returns true when user has scope permission', async () => {
			vi.spyOn(registry.client, 'scopePermission').mockResolvedValue({
				scope: 'test',
				isAdmin: true,
			} as never);

			expect(await registry.hasPermission()).toBe(true);
		});
	});

	describe('isPackageNameAvaliable', () => {
		test('returns true for valid package name', async () => {
			expect(await registry.isPackageNameAvaliable()).toBe(true);
		});
	});
});

describe('JsrClient', () => {
	let client: JsrClient;

	beforeEach(() => {
		client = new JsrClient('https://api.jsr.io');
		global.fetch = vi.fn();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe('user', () => {
		test('returns user data', async () => {
			(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
				status: 200,
				json: () => Promise.resolve({ id: 'user1', name: 'Test User' }),
			});

			const result = await client.user();

			expect(result).toEqual({ id: 'user1', name: 'Test User' });
		});

		test('returns null on 401', async () => {
			(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
				status: 401,
			});

			expect(await client.user()).toBe(null);
		});
	});

	describe('scopePermission', () => {
		test('returns scope permission', async () => {
			(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
				status: 200,
				json: () => Promise.resolve({ scope: 'test', isAdmin: true }),
			});

			const result = await client.scopePermission('test');

			expect(result).toEqual({ scope: 'test', isAdmin: true });
		});

		test('returns null on 401', async () => {
			(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
				status: 401,
			});

			expect(await client.scopePermission('test')).toBe(null);
		});
	});

	describe('scopes', () => {
		test('returns user scopes', async () => {
			(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
				status: 200,
				json: () => Promise.resolve([{ scope: 'test1' }, { scope: 'test2' }]),
			});

			const result = await client.scopes();

			expect(result).toEqual(['test1', 'test2']);
		});

		test('returns empty array on 401', async () => {
			(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
				status: 401,
			});

			expect(await client.scopes()).toEqual([]);
		});
	});

	describe('package', () => {
		test('returns package info', async () => {
			(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
				status: 200,
				json: () =>
					Promise.resolve({ name: 'package', scope: 'test', version: '1.0.0' }),
			});

			const result = await client.package('@test/package');

			expect(result.name).toBe('package');
		});
	});

	describe('createScope', () => {
		test('returns true on success', async () => {
			(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
				status: 201,
			});

			expect(await client.createScope('newscope')).toBe(true);
		});
	});

	describe('deleteScope', () => {
		test('returns true on success', async () => {
			(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
				status: 204,
			});

			expect(await client.deleteScope('scope')).toBe(true);
		});
	});

	describe('createPackage', () => {
		test('returns true on success', async () => {
			(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
				status: 201,
			});

			expect(await client.createPackage('@test/newpackage')).toBe(true);
		});
	});

	describe('deletePackage', () => {
		test('returns true on success', async () => {
			(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
				status: 204,
			});

			expect(await client.deletePackage('@test/package')).toBe(true);
		});

		test('throws error on failure', async () => {
			(global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
				new Error('Network error'),
			);

			await expect(client.deletePackage('@test/package')).rejects.toThrow();
		});
	});

	describe('searchPackage', () => {
		test('returns search results', async () => {
			(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
				status: 200,
				json: () => Promise.resolve({ items: [], total: 0 }),
			});

			const result = await client.searchPackage('test');

			expect(result).toBeDefined();
		});

		test('throws error on failure', async () => {
			(global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
				new Error('Network error'),
			);

			await expect(client.searchPackage('test')).rejects.toThrow();
		});
	});

	describe('error handling', () => {
		test('user throws error on network failure', async () => {
			(global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
				new Error('Network error'),
			);

			await expect(client.user()).rejects.toThrow();
		});

		test('scopePermission throws error on network failure', async () => {
			(global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
				new Error('Network error'),
			);

			await expect(client.scopePermission('test')).rejects.toThrow();
		});

		test('scopes throws error on network failure', async () => {
			(global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
				new Error('Network error'),
			);

			await expect(client.scopes()).rejects.toThrow();
		});

		test('package throws error on network failure', async () => {
			(global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
				new Error('Network error'),
			);

			await expect(client.package('@test/package')).rejects.toThrow();
		});

		test('createScope throws error on network failure', async () => {
			(global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
				new Error('Network error'),
			);

			await expect(client.createScope('test')).rejects.toThrow();
		});

		test('deleteScope throws error on network failure', async () => {
			(global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
				new Error('Network error'),
			);

			await expect(client.deleteScope('test')).rejects.toThrow();
		});

		test('createPackage throws error on network failure', async () => {
			(global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
				new Error('Network error'),
			);

			await expect(client.createPackage('@test/package')).rejects.toThrow();
		});
	});
});

describe('jsrRegistry factory', () => {
	test('creates JsrRegisry instance', async () => {
		const { getJsrJson } = await import('../../../src/utils/package');
		vi.mocked(getJsrJson).mockResolvedValue({
			name: '@test/package',
			version: '1.0.0',
		});

		const registry = await jsrRegistry();

		expect(registry).toBeInstanceOf(JsrRegisry);
		expect(registry.packageName).toBe('@test/package');
	});
});
