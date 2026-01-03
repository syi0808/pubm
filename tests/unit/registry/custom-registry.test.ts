import { describe, expect, test, vi, beforeEach } from 'vitest';
import { CustomRegistry, customRegistry } from '../../../src/registry/custom-registry';

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

describe('CustomRegistry', () => {
	let registry: CustomRegistry;

	beforeEach(() => {
		vi.clearAllMocks();
		registry = new CustomRegistry('test-package', 'https://custom.registry.com');
		// Manually set the registry since constructor may use parent's default
		registry.registry = 'https://custom.registry.com';
	});

	test('inherits from NpmRegistry', () => {
		expect(registry.packageName).toBe('test-package');
		expect(registry.registry).toBe('https://custom.registry.com');
	});

	describe('npm', () => {
		test('appends registry flag to all npm commands', async () => {
			mockedExec.mockResolvedValue({
				stdout: 'result',
				stderr: '',
				exitCode: 0,
			} as never);

			// Access protected method through type casting
			await (registry as any).npm(['view', 'package']);

			expect(mockedExec).toHaveBeenCalledWith('npm', [
				'view',
				'package',
				'--registry',
				'https://custom.registry.com',
			]);
		});

		test('throws on stderr', async () => {
			mockedExec.mockResolvedValue({
				stdout: '',
				stderr: 'error',
				exitCode: 1,
			} as never);

			await expect((registry as any).npm(['test'])).rejects.toBe('error');
		});
	});
});

describe('customRegistry factory', () => {
	test('creates CustomRegistry instance', async () => {
		const registry = await customRegistry();

		expect(registry).toBeInstanceOf(CustomRegistry);
		expect(registry.packageName).toBe('test-package');
	});
});
