import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	enterPreMode,
	exitPreMode,
	readPreState,
} from '../../../src/prerelease/pre.js';

vi.mock('node:fs', async () => {
	const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
	return {
		...actual,
		existsSync: vi.fn(),
		readFileSync: vi.fn(),
		writeFileSync: vi.fn(),
		mkdirSync: vi.fn(),
		rmSync: vi.fn(),
	};
});

import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';

const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);
const mockWriteFileSync = vi.mocked(writeFileSync);
const mockMkdirSync = vi.mocked(mkdirSync);
const mockRmSync = vi.mocked(rmSync);

afterEach(() => {
	vi.restoreAllMocks();
});

describe('readPreState', () => {
	it('should return null when pre.json does not exist', () => {
		mockExistsSync.mockReturnValue(false);

		const result = readPreState('/tmp/project');

		expect(result).toBeNull();
	});

	it('should read and parse pre.json when it exists', () => {
		const state = {
			mode: 'pre' as const,
			tag: 'beta',
			packages: {
				'my-pkg': { baseVersion: '1.0.0', iteration: 1 },
			},
		};

		mockExistsSync.mockReturnValue(true);
		mockReadFileSync.mockReturnValue(JSON.stringify(state));

		const result = readPreState('/tmp/project');

		expect(result).toEqual(state);
		expect(result?.mode).toBe('pre');
		expect(result?.tag).toBe('beta');
		expect(result?.packages['my-pkg']).toEqual({
			baseVersion: '1.0.0',
			iteration: 1,
		});
	});
});

describe('enterPreMode', () => {
	it('should create pre.json with the given tag', () => {
		mockExistsSync.mockReturnValue(false);

		enterPreMode('alpha', '/tmp/project');

		expect(mockMkdirSync).toHaveBeenCalledWith(
			expect.stringContaining('.pubm'),
			{ recursive: true },
		);
		expect(mockWriteFileSync).toHaveBeenCalledWith(
			expect.stringContaining('pre.json'),
			JSON.stringify(
				{
					mode: 'pre',
					tag: 'alpha',
					packages: {},
				},
				null,
				2,
			),
			'utf-8',
		);
	});

	it('should throw when already in pre mode', () => {
		mockExistsSync.mockReturnValue(true);

		expect(() => enterPreMode('beta', '/tmp/project')).toThrow(
			'Already in pre mode',
		);
	});
});

describe('exitPreMode', () => {
	it('should delete pre.json', () => {
		mockExistsSync.mockReturnValue(true);

		exitPreMode('/tmp/project');

		expect(mockRmSync).toHaveBeenCalledWith(
			expect.stringContaining('pre.json'),
		);
	});

	it('should throw when not in pre mode', () => {
		mockExistsSync.mockReturnValue(false);

		expect(() => exitPreMode('/tmp/project')).toThrow('Not in pre mode');
	});
});
