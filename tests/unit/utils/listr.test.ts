import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockListrInstance = {
	isRoot: () => true,
	externalSignalHandler: undefined as unknown,
};

vi.mock('listr2', () => {
	return {
		Listr: vi.fn(() => mockListrInstance),
	};
});

vi.mock('../../../src/utils/rollback.js', () => {
	return {
		rollback: vi.fn(),
	};
});

let createListr: typeof import('../../../src/utils/listr.js').createListr;
let rollbackFn: typeof import('../../../src/utils/rollback.js').rollback;

beforeEach(async () => {
	mockListrInstance.isRoot = () => true;
	mockListrInstance.externalSignalHandler = undefined;

	vi.resetModules();

	// Re-apply mocks after resetModules since hoisted mocks persist
	const listrMod = await import('../../../src/utils/listr.js');
	createListr = listrMod.createListr;

	const rollbackMod = await import('../../../src/utils/rollback.js');
	rollbackFn = rollbackMod.rollback;
});

describe('createListr', () => {
	it('returns a Listr instance', () => {
		const result = createListr([]);

		expect(result).toBeDefined();
		expect(result).toBe(mockListrInstance);
	});

	it('overrides isRoot to always return false', () => {
		const result = createListr([]);

		expect(result.isRoot()).toBe(false);
	});

	it('sets externalSignalHandler to the rollback function', () => {
		const result = createListr([]);

		expect((result as any).externalSignalHandler).toBe(rollbackFn);
	});
});
