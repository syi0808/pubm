import { describe, expect, test, vi, beforeEach } from 'vitest';
import { validateEngineVersion } from '../../src/utils/engine-version';

vi.mock('../../src/utils/package', () => ({
	getPackageJson: vi.fn(),
}));

import { getPackageJson } from '../../src/utils/package';

const mockedGetPackageJson = vi.mocked(getPackageJson);

describe('validateEngineVersion', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	test('returns true when node version satisfies requirement', async () => {
		mockedGetPackageJson.mockResolvedValue({
			name: 'test',
			version: '1.0.0',
			engines: {
				node: '>=18.0.0',
			},
		});

		const result = await validateEngineVersion('node', '20.0.0');

		expect(result).toBe(true);
	});

	test('returns false when node version does not satisfy requirement', async () => {
		mockedGetPackageJson.mockResolvedValue({
			name: 'test',
			version: '1.0.0',
			engines: {
				node: '>=20.0.0',
			},
		});

		const result = await validateEngineVersion('node', '18.0.0');

		expect(result).toBe(false);
	});

	test('returns true for prerelease versions', async () => {
		mockedGetPackageJson.mockResolvedValue({
			name: 'test',
			version: '1.0.0',
			engines: {
				node: '>=18.0.0',
			},
		});

		const result = await validateEngineVersion('node', '20.0.0-beta.1');

		expect(result).toBe(true);
	});

	test('handles git engine', async () => {
		mockedGetPackageJson.mockResolvedValue({
			name: 'test',
			version: '1.0.0',
			engines: {
				git: '>=2.11.0',
			},
		});

		const result = await validateEngineVersion('git', '2.40.0');

		expect(result).toBe(true);
	});

	test('returns false when engine requirement not found', async () => {
		mockedGetPackageJson.mockResolvedValue({
			name: 'test',
			version: '1.0.0',
			engines: {},
		});

		const result = await validateEngineVersion('node', '20.0.0');

		expect(result).toBe(false);
	});
});
