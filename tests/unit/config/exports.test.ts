import { describe, expect, it } from 'vitest';

describe('public API exports', () => {
	it('exports defineConfig from pubm', async () => {
		const { defineConfig } = await import('../../../src/index.js');
		expect(typeof defineConfig).toBe('function');
	});

	it('defineConfig returns the config unchanged', async () => {
		const { defineConfig } = await import('../../../src/index.js');
		const config = { registries: ['npm'] as const, branch: 'main' };
		expect(defineConfig(config as any)).toEqual(config);
	});
});
