import { describe, expect, test, vi, beforeEach } from 'vitest';
import { getRegistry } from '../../../src/registry/index';

vi.mock('../../../src/registry/npm', () => ({
	npmRegistry: vi.fn().mockResolvedValue({
		packageName: 'test',
		registry: 'https://registry.npmjs.org',
	}),
}));

vi.mock('../../../src/registry/jsr', () => ({
	jsrRegistry: vi.fn().mockResolvedValue({
		packageName: 'test',
		registry: 'https://jsr.io',
	}),
}));

vi.mock('../../../src/registry/custom-registry', () => ({
	customRegistry: vi.fn().mockResolvedValue({
		packageName: 'test',
		registry: 'https://custom.registry.com',
	}),
}));

describe('getRegistry', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	test('returns npm registry for npm key', async () => {
		const registry = await getRegistry('npm');

		expect(registry.registry).toBe('https://registry.npmjs.org');
	});

	test('returns jsr registry for jsr key', async () => {
		const registry = await getRegistry('jsr');

		expect(registry.registry).toBe('https://jsr.io');
	});

	test('returns custom registry for unknown key', async () => {
		const registry = await getRegistry('https://private.registry.com');

		expect(registry.registry).toBe('https://custom.registry.com');
	});
});
