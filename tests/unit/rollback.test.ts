import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';

// We need to test the module in isolation to avoid state pollution
describe('rollback module', () => {
	let addRollback: typeof import('../../src/utils/rollback').addRollback;
	let rollback: typeof import('../../src/utils/rollback').rollback;

	beforeEach(async () => {
		// Reset module state by re-importing
		vi.resetModules();
		const module = await import('../../src/utils/rollback');
		addRollback = module.addRollback;
		rollback = module.rollback;
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	test('addRollback adds rollback function', async () => {
		const mockFn = vi.fn().mockResolvedValue(undefined);
		const ctx = { test: true };

		addRollback(mockFn, ctx);

		// The function is added but not called until rollback is triggered
		expect(mockFn).not.toHaveBeenCalled();
	});

	test('rollback executes all rollback functions', async () => {
		const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
		const mockFn1 = vi.fn().mockResolvedValue(undefined);
		const mockFn2 = vi.fn().mockResolvedValue(undefined);

		addRollback(mockFn1, { id: 1 });
		addRollback(mockFn2, { id: 2 });

		await rollback();

		expect(mockFn1).toHaveBeenCalledWith({ id: 1 });
		expect(mockFn2).toHaveBeenCalledWith({ id: 2 });
		expect(consoleSpy).toHaveBeenCalledWith('Rollback...');
		expect(consoleSpy).toHaveBeenCalledWith('Rollback completed');

		consoleSpy.mockRestore();
	});

	test('rollback only executes once', async () => {
		const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
		const mockFn = vi.fn().mockResolvedValue(undefined);

		addRollback(mockFn, {});

		await rollback();
		await rollback();
		await rollback();

		expect(mockFn).toHaveBeenCalledTimes(1);

		consoleSpy.mockRestore();
	});

	test('rollback does nothing when no rollbacks registered', async () => {
		const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

		await rollback();

		expect(consoleSpy).not.toHaveBeenCalled();

		consoleSpy.mockRestore();
	});
});
