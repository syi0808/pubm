import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/utils/package.js', () => ({
	getPackageJson: vi.fn(),
}));

import { validateEngineVersion } from '../../../src/utils/engine-version.js';
import { getPackageJson } from '../../../src/utils/package.js';

const mockGetPackageJson = vi.mocked(getPackageJson);

describe('validateEngineVersion', () => {
	beforeEach(() => {
		mockGetPackageJson.mockReset();
	});

	it('returns true when the version satisfies the engine constraint', async () => {
		mockGetPackageJson.mockResolvedValue({
			name: 'pubm',
			version: '1.0.0',
			engines: {
				node: '>=18.0.0',
				git: '*',
				npm: '*',
				pnpm: '*',
				yarn: '*',
			},
		});

		const result = await validateEngineVersion('node', '20.11.0');
		expect(result).toBe(true);
	});

	it('returns false when the version does not satisfy the engine constraint', async () => {
		mockGetPackageJson.mockResolvedValue({
			name: 'pubm',
			version: '1.0.0',
			engines: {
				node: '>=18.0.0',
				git: '*',
				npm: '*',
				pnpm: '*',
				yarn: '*',
			},
		});

		const result = await validateEngineVersion('node', '16.0.0');
		expect(result).toBe(false);
	});

	it('returns true for prerelease versions when includePrerelease is enabled', async () => {
		mockGetPackageJson.mockResolvedValue({
			name: 'pubm',
			version: '1.0.0',
			engines: {
				node: '>=18.0.0',
				git: '*',
				npm: '*',
				pnpm: '*',
				yarn: '*',
			},
		});

		const result = await validateEngineVersion('node', '20.0.0-rc.1');
		expect(result).toBe(true);
	});

	it('handles missing engines field gracefully', async () => {
		mockGetPackageJson.mockResolvedValue({
			name: 'pubm',
			version: '1.0.0',
		});

		// When engines is undefined, satisfies receives "undefined" as range
		// semver.satisfies with an invalid range returns false
		const result = await validateEngineVersion('node', '20.0.0');
		expect(result).toBe(false);
	});

	it('validates different engine types', async () => {
		mockGetPackageJson.mockResolvedValue({
			name: 'pubm',
			version: '1.0.0',
			engines: {
				node: '>=18.0.0',
				git: '>=2.30.0',
				npm: '>=8.0.0',
				pnpm: '>=7.0.0',
				yarn: '>=1.22.0',
			},
		});

		expect(await validateEngineVersion('git', '2.40.0')).toBe(true);
		expect(await validateEngineVersion('git', '2.20.0')).toBe(false);
		expect(await validateEngineVersion('npm', '10.0.0')).toBe(true);
		expect(await validateEngineVersion('pnpm', '9.0.0')).toBe(true);
		expect(await validateEngineVersion('yarn', '1.22.19')).toBe(true);
	});

	it('handles a specific engine being undefined while others exist', async () => {
		mockGetPackageJson.mockResolvedValue({
			name: 'pubm',
			version: '1.0.0',
			engines: {
				node: '>=18.0.0',
				git: '*',
				npm: '*',
				pnpm: '*',
				yarn: '*',
			},
		});

		// 'pnpm' constraint is '*', any version satisfies
		const result = await validateEngineVersion('pnpm', '1.0.0');
		expect(result).toBe(true);
	});
});
