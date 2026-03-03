import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { defineConfig, loadConfig } from '../../../src/config/loader.js';

describe('defineConfig', () => {
	it('returns the config as-is (identity function)', () => {
		const config = defineConfig({
			registries: ['npm'],
			branch: 'main',
		});
		expect(config).toEqual({ registries: ['npm'], branch: 'main' });
	});
});

describe('loadConfig', () => {
	it('returns null when no config file exists', async () => {
		const result = await loadConfig(
			path.resolve(__dirname, '../../fixtures/basic'),
		);
		expect(result).toBeNull();
	});

	it('loads pubm.config.ts when it exists', async () => {
		const result = await loadConfig(
			path.resolve(__dirname, '../../fixtures/with-config'),
		);
		expect(result).not.toBeNull();
		expect(result!.versioning).toBe('independent');
		expect(result!.packages).toHaveLength(2);
		expect(result!.packages![0].path).toBe('packages/my-lib');
	});
});
