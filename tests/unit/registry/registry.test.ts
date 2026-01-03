import { describe, expect, test } from 'vitest';
import { Registry } from '../../../src/registry/registry';

// Create a concrete implementation for testing
class TestRegistry extends Registry {
	async ping(): Promise<boolean> {
		return true;
	}
	async isInstalled(): Promise<boolean> {
		return true;
	}
	async distTags(): Promise<string[]> {
		return ['latest'];
	}
	async version(): Promise<string> {
		return '1.0.0';
	}
	async publish(): Promise<boolean> {
		return true;
	}
	async isPublished(): Promise<boolean> {
		return true;
	}
	async hasPermission(): Promise<boolean> {
		return true;
	}
	async isPackageNameAvaliable(): Promise<boolean> {
		return true;
	}
}

describe('Registry', () => {
	test('constructs with package name', () => {
		const registry = new TestRegistry('test-package');

		expect(registry.packageName).toBe('test-package');
		expect(registry.registry).toBeUndefined();
	});

	test('constructs with package name and registry', () => {
		const registry = new TestRegistry(
			'test-package',
			'https://custom.registry.com',
		);

		expect(registry.packageName).toBe('test-package');
		expect(registry.registry).toBe('https://custom.registry.com');
	});

	test('abstract methods are callable', async () => {
		const registry = new TestRegistry('test-package');

		expect(await registry.ping()).toBe(true);
		expect(await registry.isInstalled()).toBe(true);
		expect(await registry.distTags()).toEqual(['latest']);
		expect(await registry.version()).toBe('1.0.0');
		expect(await registry.publish()).toBe(true);
		expect(await registry.isPublished()).toBe(true);
		expect(await registry.hasPermission()).toBe(true);
		expect(await registry.isPackageNameAvaliable()).toBe(true);
	});
});
