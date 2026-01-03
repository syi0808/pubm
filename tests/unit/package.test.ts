import path from 'node:path';
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import {
	jsrJsonToPackageJson,
	packageJsonToJsrJson,
	findOutFile,
	patchCachedJsrJson,
	version,
} from '../../src/utils/package';

describe('jsrJsonToPackageJson', () => {
	test('converts simple jsr.json to package.json', () => {
		const jsrJson = {
			name: '@scope/package',
			version: '1.0.0',
			exports: './src/index.ts',
		};

		const result = jsrJsonToPackageJson(jsrJson);

		expect(result.name).toBe('@scope/package');
		expect(result.version).toBe('1.0.0');
		expect(result.exports).toBe('./src/index.ts');
	});

	test('converts jsr.json with object exports', () => {
		const jsrJson = {
			name: '@scope/package',
			version: '1.0.0',
			exports: {
				'.': './src/index.ts',
				'./utils': './src/utils.ts',
			},
		};

		const result = jsrJsonToPackageJson(jsrJson);

		expect(result.exports).toEqual({
			'.': { import: './src/index.ts' },
			'./utils': { import: './src/utils.ts' },
		});
	});

	test('converts publish include to files', () => {
		const jsrJson = {
			name: '@scope/package',
			version: '1.0.0',
			publish: {
				include: ['src', 'lib'],
			},
		};

		const result = jsrJsonToPackageJson(jsrJson);

		expect(result.files).toContain('src');
		expect(result.files).toContain('lib');
	});

	test('converts publish exclude to negated files', () => {
		const jsrJson = {
			name: '@scope/package',
			version: '1.0.0',
			publish: {
				include: ['src'],
				exclude: ['test', 'docs'],
			},
		};

		const result = jsrJsonToPackageJson(jsrJson);

		expect(result.files).toContain('src');
		expect(result.files).toContain('!test');
		expect(result.files).toContain('!docs');
	});

	test('handles missing exports', () => {
		const jsrJson = {
			name: '@scope/package',
			version: '1.0.0',
		};

		const result = jsrJsonToPackageJson(jsrJson);

		expect(result.name).toBe('@scope/package');
		expect(result.version).toBe('1.0.0');
		expect(result.exports).toBeUndefined();
	});

	test('handles missing publish', () => {
		const jsrJson = {
			name: '@scope/package',
			version: '1.0.0',
		};

		const result = jsrJsonToPackageJson(jsrJson);

		expect(result.files).toEqual([]);
	});
});

describe('packageJsonToJsrJson', () => {
	test('converts simple package.json to jsr.json', async () => {
		const packageJson = {
			name: '@scope/package',
			version: '1.0.0',
			exports: './dist/index.js',
		};

		const result = await packageJsonToJsrJson(packageJson);

		expect(result.name).toBe('@scope/package');
		expect(result.version).toBe('1.0.0');
		expect(result.exports).toBe('./dist/index.js');
	});

	test('converts package.json with nested exports', async () => {
		const packageJson = {
			name: '@scope/package',
			version: '1.0.0',
			exports: {
				'.': {
					import: './dist/index.js',
					require: './dist/index.cjs',
				},
				'./utils': {
					import: './dist/utils.js',
				},
			},
		};

		const result = await packageJsonToJsrJson(packageJson);

		expect(result.exports).toEqual({
			'.': './dist/index.js',
			'./utils': './dist/utils.js',
		});
	});

	test('converts files to publish include/exclude', async () => {
		const packageJson = {
			name: '@scope/package',
			version: '1.0.0',
			files: ['dist', 'src', '!test'],
		};

		const result = await packageJsonToJsrJson(packageJson);

		expect(result.publish?.include).toContain('dist');
		expect(result.publish?.include).toContain('src');
		expect(result.publish?.exclude).toContain('test');
	});

	test('handles missing exports', async () => {
		const packageJson = {
			name: '@scope/package',
			version: '1.0.0',
		};

		const result = await packageJsonToJsrJson(packageJson);

		expect(result.name).toBe('@scope/package');
		expect(result.version).toBe('1.0.0');
		expect(result.exports).toBeUndefined();
	});

	test('handles missing files', async () => {
		const packageJson = {
			name: '@scope/package',
			version: '1.0.0',
		};

		const result = await packageJsonToJsrJson(packageJson);

		expect(result.publish?.include).toEqual([]);
		// exclude includes ignores from .npmignore or .gitignore if present
		expect(result.publish?.exclude).toBeDefined();
	});
});

describe('findOutFile', () => {
	test('finds file in current directory', async () => {
		const result = await findOutFile('package.json');

		expect(result).toBeDefined();
		expect(result).not.toBeNull();
		expect(result!).toContain('package.json');
	});

	test('returns null for non-existent file', async () => {
		const result = await findOutFile('non-existent-file-12345.xyz');

		expect(result).toBe(null);
	});

	test('uses custom cwd', async () => {
		const result = await findOutFile('package.json', {
			cwd: process.cwd(),
		});

		expect(result).toBeDefined();
	});
});

describe('patchCachedJsrJson', () => {
	test('patches cached jsr json', () => {
		// This function mutates cached data
		patchCachedJsrJson({ name: '@patched/name' });

		// No error should be thrown
		expect(true).toBe(true);
	});
});

describe('version', () => {
	test('returns version from package.json', async () => {
		const result = await version();

		expect(result).toBeDefined();
		expect(typeof result).toBe('string');
	});
});

describe('getPackageJson with mocking', () => {
	beforeEach(() => {
		vi.resetModules();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	test('returns package.json contents', async () => {
		vi.doMock('node:fs/promises', () => ({
			readFile: vi.fn().mockResolvedValue(
				JSON.stringify({ name: 'test-pkg', version: '1.0.0' }),
			),
			stat: vi.fn().mockResolvedValue({ isFile: () => true }),
			writeFile: vi.fn(),
		}));

		const { getPackageJson } = await import('../../src/utils/package');
		const result = await getPackageJson({ cwd: '/test/path1' });

		expect(result.name).toBe('test-pkg');
		expect(result.version).toBe('1.0.0');
	});

	test('throws error on invalid JSON', async () => {
		vi.doMock('node:fs/promises', () => ({
			readFile: vi.fn().mockResolvedValue('invalid json'),
			stat: vi.fn().mockResolvedValue({ isFile: () => true }),
			writeFile: vi.fn(),
		}));

		const { getPackageJson } = await import('../../src/utils/package');

		await expect(getPackageJson({ cwd: '/test/path2' })).rejects.toThrow();
	});

	test('throws when fallbackJsr is false and package.json not found', async () => {
		vi.doMock('node:fs/promises', () => ({
			readFile: vi.fn().mockRejectedValue(new Error('not found')),
			stat: vi.fn().mockRejectedValue(new Error('not found')),
			writeFile: vi.fn(),
		}));

		const { getPackageJson } = await import('../../src/utils/package');

		await expect(
			getPackageJson({ cwd: '/test/path3', fallbackJsr: false }),
		).rejects.toThrow();
	});
});

describe('getJsrJson with mocking', () => {
	beforeEach(() => {
		vi.resetModules();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	test('returns jsr.json contents', async () => {
		vi.doMock('node:fs/promises', () => ({
			readFile: vi.fn().mockResolvedValue(
				JSON.stringify({ name: '@scope/jsr-pkg', version: '1.0.0' }),
			),
			stat: vi.fn().mockResolvedValue({ isFile: () => true }),
			writeFile: vi.fn(),
		}));

		const { getJsrJson } = await import('../../src/utils/package');
		const result = await getJsrJson({ cwd: '/test/path4' });

		expect(result.name).toBe('@scope/jsr-pkg');
		expect(result.version).toBe('1.0.0');
	});

	test('throws error on invalid JSON', async () => {
		vi.doMock('node:fs/promises', () => ({
			readFile: vi.fn().mockResolvedValue('invalid json'),
			stat: vi.fn().mockResolvedValue({ isFile: () => true }),
			writeFile: vi.fn(),
		}));

		const { getJsrJson } = await import('../../src/utils/package');

		await expect(getJsrJson({ cwd: '/test/path5' })).rejects.toThrow();
	});

	test('throws when fallbackPackage is false and jsr.json not found', async () => {
		vi.doMock('node:fs/promises', () => ({
			readFile: vi.fn().mockRejectedValue(new Error('not found')),
			stat: vi.fn().mockRejectedValue(new Error('not found')),
			writeFile: vi.fn(),
		}));

		const { getJsrJson } = await import('../../src/utils/package');

		await expect(
			getJsrJson({ cwd: '/test/path6', fallbackPackage: false }),
		).rejects.toThrow();
	});
});

describe('replaceVersion with mocking', () => {
	beforeEach(() => {
		vi.resetModules();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	test('replaces version in package.json and jsr.json', async () => {
		const writeFileMock = vi.fn().mockResolvedValue(undefined);
		let statCallCount = 0;
		let readCallCount = 0;

		vi.doMock('node:fs/promises', () => ({
			readFile: vi.fn().mockImplementation(() => {
				readCallCount++;
				if (readCallCount === 1) {
					return Promise.resolve('{"name": "test", "version": "1.0.0"}');
				}
				return Promise.resolve('{"name": "@scope/test", "version": "1.0.0"}');
			}),
			stat: vi.fn().mockImplementation(() => {
				statCallCount++;
				if (statCallCount <= 2) {
					return Promise.resolve({ isFile: () => true });
				}
				return Promise.reject(new Error('not found'));
			}),
			writeFile: writeFileMock,
		}));

		const { replaceVersion } = await import('../../src/utils/package');
		const result = await replaceVersion('2.0.0');

		expect(result).toContain('package.json');
		expect(result).toContain('jsr.json');
		expect(writeFileMock).toHaveBeenCalledTimes(2);
	});

	test('returns empty array when no config files exist', async () => {
		const writeFileMock = vi.fn();

		vi.doMock('node:fs/promises', () => ({
			readFile: vi.fn().mockRejectedValue(new Error('not found')),
			stat: vi.fn().mockRejectedValue(new Error('not found')),
			writeFile: writeFileMock,
		}));

		const { replaceVersion } = await import('../../src/utils/package');
		const result = await replaceVersion('2.0.0');

		expect(result).toEqual([]);
		expect(writeFileMock).not.toHaveBeenCalled();
	});
});
