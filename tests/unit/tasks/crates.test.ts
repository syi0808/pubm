import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/registry/crates.js', () => ({
	CratesRegistry: vi.fn().mockImplementation(() => ({
		isInstalled: vi.fn().mockResolvedValue(true),
		hasPermission: vi.fn().mockResolvedValue(true),
		publish: vi.fn().mockResolvedValue(true),
	})),
}));

import {
	cratesAvailableCheckTasks,
	cratesPublishTasks,
} from '../../../src/tasks/crates.js';

describe('cratesAvailableCheckTasks', () => {
	it('has the correct title', () => {
		expect(cratesAvailableCheckTasks.title).toBe(
			'Checking crates.io availability',
		);
	});

	it('has a task function', () => {
		expect(typeof cratesAvailableCheckTasks.task).toBe('function');
	});
});

describe('cratesPublishTasks', () => {
	it('has the correct title', () => {
		expect(cratesPublishTasks.title).toBe('Publishing to crates.io');
	});

	it('has a task function', () => {
		expect(typeof cratesPublishTasks.task).toBe('function');
	});
});
