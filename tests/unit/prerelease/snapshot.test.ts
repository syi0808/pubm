import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateSnapshotVersion } from '../../../src/prerelease/snapshot.js';

describe('generateSnapshotVersion', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-03-04T12:30:00Z'));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('should generate default snapshot version', () => {
		const result = generateSnapshotVersion({ tag: 'canary' });

		expect(result).toBe('0.0.0-canary-20260304T123000');
	});

	it('should use calculated version as base', () => {
		const result = generateSnapshotVersion({
			tag: 'canary',
			baseVersion: '2.1.0',
			useCalculatedVersion: true,
		});

		expect(result).toBe('2.1.0-canary-20260304T123000');
	});

	it('should use custom template', () => {
		const result = generateSnapshotVersion({
			tag: 'dev',
			template: '{base}-{tag}-{commit}',
			commit: 'abc1234',
		});

		expect(result).toBe('0.0.0-dev-abc1234');
	});

	it('should default tag to snapshot', () => {
		const result = generateSnapshotVersion({});

		expect(result).toBe('0.0.0-snapshot-20260304T123000');
	});
});
