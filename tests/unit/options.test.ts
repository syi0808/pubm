import { describe, expect, test } from 'vitest';
import { defaultOptions, resolveOptions } from '../../src/options';

describe('defaultOptions', () => {
	test('has correct default values', () => {
		expect(defaultOptions.testScript).toBe('test');
		expect(defaultOptions.buildScript).toBe('build');
		expect(defaultOptions.branch).toBe('main');
		expect(defaultOptions.tag).toBe('latest');
		expect(defaultOptions.registries).toEqual(['npm', 'jsr']);
	});
});

describe('resolveOptions', () => {
	test('merges user options with defaults', () => {
		const result = resolveOptions({ version: '1.0.0' });

		expect(result.version).toBe('1.0.0');
		expect(result.testScript).toBe('test');
		expect(result.buildScript).toBe('build');
		expect(result.branch).toBe('main');
		expect(result.tag).toBe('latest');
		expect(result.registries).toEqual(['npm', 'jsr']);
	});

	test('overrides defaults with user options', () => {
		const result = resolveOptions({
			version: '2.0.0',
			testScript: 'custom-test',
			buildScript: 'custom-build',
			branch: 'develop',
			tag: 'beta',
			registries: ['npm'],
		});

		expect(result.version).toBe('2.0.0');
		expect(result.testScript).toBe('custom-test');
		expect(result.buildScript).toBe('custom-build');
		expect(result.branch).toBe('develop');
		expect(result.tag).toBe('beta');
		expect(result.registries).toEqual(['npm']);
	});

	test('handles partial user options', () => {
		const result = resolveOptions({
			version: '1.5.0',
			branch: 'release',
		});

		expect(result.version).toBe('1.5.0');
		expect(result.branch).toBe('release');
		expect(result.testScript).toBe('test');
		expect(result.buildScript).toBe('build');
	});

	test('handles skip options', () => {
		const result = resolveOptions({
			version: '1.0.0',
			skipTests: true,
			skipBuild: true,
			skipPublish: true,
		});

		expect(result.skipTests).toBe(true);
		expect(result.skipBuild).toBe(true);
		expect(result.skipPublish).toBe(true);
	});

	test('handles preview mode', () => {
		const result = resolveOptions({
			version: '1.0.0',
			preview: true,
		});

		expect(result.preview).toBe(true);
	});

	test('handles anyBranch option', () => {
		const result = resolveOptions({
			version: '1.0.0',
			anyBranch: true,
		});

		expect(result.anyBranch).toBe(true);
	});

	test('handles publishOnly option', () => {
		const result = resolveOptions({
			version: '1.0.0',
			publishOnly: true,
		});

		expect(result.publishOnly).toBe(true);
	});

	test('handles contents option', () => {
		const result = resolveOptions({
			version: '1.0.0',
			contents: './dist',
		});

		expect(result.contents).toBe('./dist');
	});

	test('handles saveToken option', () => {
		const result = resolveOptions({
			version: '1.0.0',
			saveToken: false,
		});

		expect(result.saveToken).toBe(false);
	});

	test('handles custom registry URLs', () => {
		const result = resolveOptions({
			version: '1.0.0',
			registries: ['https://registry.example.com'],
		});

		expect(result.registries).toEqual(['https://registry.example.com']);
	});

	test('handles multiple registries including custom', () => {
		const result = resolveOptions({
			version: '1.0.0',
			registries: ['npm', 'jsr', 'https://private.registry.com'],
		});

		expect(result.registries).toEqual([
			'npm',
			'jsr',
			'https://private.registry.com',
		]);
	});
});
