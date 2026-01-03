import { describe, expect, test, vi } from 'vitest';
import { createListr } from '../../src/utils/listr';

describe('createListr', () => {
	test('creates Listr instance', () => {
		const listr = createListr([]);

		expect(listr).toBeDefined();
		expect(typeof listr.run).toBe('function');
	});

	test('sets isRoot to return false', () => {
		const listr = createListr([]);

		expect(listr.isRoot()).toBe(false);
	});

	test('creates Listr with tasks', () => {
		const listr = createListr([
			{
				title: 'Task 1',
				task: () => {},
			},
			{
				title: 'Task 2',
				task: () => {},
			},
		]);

		expect(listr).toBeDefined();
	});

	test('creates Listr with options', () => {
		const listr = createListr(
			[
				{
					title: 'Task 1',
					task: () => {},
				},
			],
			{
				concurrent: false,
				exitOnError: true,
			},
		);

		expect(listr).toBeDefined();
	});
});
