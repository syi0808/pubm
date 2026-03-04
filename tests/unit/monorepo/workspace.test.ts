import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:fs', () => ({
	existsSync: vi.fn(),
	readFileSync: vi.fn(),
}));

vi.mock('yaml', () => ({
	parse: vi.fn(),
}));

import { existsSync, readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { detectWorkspace } from '../../../src/monorepo/workspace.js';

const mockedExistsSync = vi.mocked(existsSync);
const mockedReadFileSync = vi.mocked(readFileSync);
const mockedYamlParse = vi.mocked(parse);

beforeEach(() => {
	vi.clearAllMocks();
});

describe('detectWorkspace', () => {
	it('returns null when no workspace config is found', () => {
		mockedExistsSync.mockReturnValue(false);

		const result = detectWorkspace('/project');

		expect(result).toBeNull();
	});

	it('detects pnpm workspace from pnpm-workspace.yaml', () => {
		mockedExistsSync.mockImplementation((path) =>
			String(path).endsWith('pnpm-workspace.yaml'),
		);
		mockedReadFileSync.mockReturnValue('packages:\n  - packages/*\n');
		mockedYamlParse.mockReturnValue({ packages: ['packages/*'] });

		const result = detectWorkspace('/project');

		expect(result).toEqual({
			type: 'pnpm',
			patterns: ['packages/*'],
		});
	});

	it('detects npm/yarn workspace from package.json workspaces array', () => {
		mockedExistsSync.mockImplementation(
			(path) =>
				!String(path).endsWith('pnpm-workspace.yaml') &&
				String(path).endsWith('package.json'),
		);
		mockedReadFileSync.mockReturnValue(
			JSON.stringify({ workspaces: ['packages/*', 'apps/*'] }),
		);

		const result = detectWorkspace('/project');

		expect(result).toEqual({
			type: 'npm',
			patterns: ['packages/*', 'apps/*'],
		});
	});

	it('handles yarn workspaces object format { packages: [...] }', () => {
		mockedExistsSync.mockImplementation(
			(path) =>
				!String(path).endsWith('pnpm-workspace.yaml') &&
				String(path).endsWith('package.json'),
		);
		mockedReadFileSync.mockReturnValue(
			JSON.stringify({
				workspaces: { packages: ['packages/*', 'modules/*'] },
			}),
		);

		const result = detectWorkspace('/project');

		expect(result).toEqual({
			type: 'yarn',
			patterns: ['packages/*', 'modules/*'],
		});
	});

	it('pnpm-workspace.yaml takes priority over package.json', () => {
		mockedExistsSync.mockReturnValue(true);
		mockedReadFileSync.mockReturnValue('packages:\n  - libs/*\n');
		mockedYamlParse.mockReturnValue({ packages: ['libs/*'] });

		const result = detectWorkspace('/project');

		expect(result).toEqual({
			type: 'pnpm',
			patterns: ['libs/*'],
		});
		// readFileSync should only have been called once (for pnpm-workspace.yaml)
		expect(mockedReadFileSync).toHaveBeenCalledTimes(1);
	});

	it('returns empty patterns when pnpm-workspace.yaml has no packages field', () => {
		mockedExistsSync.mockImplementation((path) =>
			String(path).endsWith('pnpm-workspace.yaml'),
		);
		mockedReadFileSync.mockReturnValue('');
		mockedYamlParse.mockReturnValue(null);

		const result = detectWorkspace('/project');

		expect(result).toEqual({
			type: 'pnpm',
			patterns: [],
		});
	});

	it('returns null when package.json has no workspaces field', () => {
		mockedExistsSync.mockImplementation(
			(path) =>
				!String(path).endsWith('pnpm-workspace.yaml') &&
				String(path).endsWith('package.json'),
		);
		mockedReadFileSync.mockReturnValue(JSON.stringify({ name: 'my-app' }));

		const result = detectWorkspace('/project');

		expect(result).toBeNull();
	});

	it('uses process.cwd() when no cwd is provided', () => {
		mockedExistsSync.mockReturnValue(false);

		detectWorkspace();

		expect(mockedExistsSync).toHaveBeenCalled();
	});
});
