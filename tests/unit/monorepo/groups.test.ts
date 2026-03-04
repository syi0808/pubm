import { describe, expect, it } from 'vitest';
import type { BumpType } from '../../../src/changeset/parser.js';
import {
	applyFixedGroup,
	applyLinkedGroup,
	resolveGroups,
} from '../../../src/monorepo/groups.js';

describe('resolveGroups', () => {
	const allPackages = [
		'@scope/core',
		'@scope/utils',
		'@scope/cli',
		'@other/lib',
		'standalone',
	];

	it('resolves glob patterns to matching package names', () => {
		const groups = [['@scope/*']];

		const result = resolveGroups(groups, allPackages);

		expect(result).toEqual([['@scope/core', '@scope/utils', '@scope/cli']]);
	});

	it('passes through exact names', () => {
		const groups = [['standalone', '@other/lib']];

		const result = resolveGroups(groups, allPackages);

		expect(result).toEqual([['standalone', '@other/lib']]);
	});

	it('resolves multiple groups independently', () => {
		const groups = [['@scope/*'], ['@other/*', 'standalone']];

		const result = resolveGroups(groups, allPackages);

		expect(result).toHaveLength(2);
		expect(result[0]).toEqual(['@scope/core', '@scope/utils', '@scope/cli']);
		expect(result[1]).toEqual(['@other/lib', 'standalone']);
	});

	it('deduplicates when patterns overlap', () => {
		const groups = [['@scope/core', '@scope/*']];

		const result = resolveGroups(groups, allPackages);

		expect(result[0]).toEqual(['@scope/core', '@scope/utils', '@scope/cli']);
	});

	it('returns empty array for non-matching patterns', () => {
		const groups = [['@nonexistent/*']];

		const result = resolveGroups(groups, allPackages);

		expect(result).toEqual([[]]);
	});
});

describe('applyFixedGroup', () => {
	it('applies max bump to all packages in the group', () => {
		const bumps = new Map<string, BumpType>([
			['pkg-a', 'patch'],
			['pkg-b', 'minor'],
		]);
		const group = ['pkg-a', 'pkg-b', 'pkg-c'];

		applyFixedGroup(bumps, group);

		expect(bumps.get('pkg-a')).toBe('minor');
		expect(bumps.get('pkg-b')).toBe('minor');
		expect(bumps.get('pkg-c')).toBe('minor');
	});

	it('does nothing when no packages in the group have bumps', () => {
		const bumps = new Map<string, BumpType>([['pkg-x', 'major']]);
		const group = ['pkg-a', 'pkg-b'];

		applyFixedGroup(bumps, group);

		expect(bumps.has('pkg-a')).toBe(false);
		expect(bumps.has('pkg-b')).toBe(false);
		expect(bumps.get('pkg-x')).toBe('major');
	});

	it('propagates major as max bump', () => {
		const bumps = new Map<string, BumpType>([
			['pkg-a', 'patch'],
			['pkg-b', 'major'],
			['pkg-c', 'minor'],
		]);
		const group = ['pkg-a', 'pkg-b', 'pkg-c'];

		applyFixedGroup(bumps, group);

		expect(bumps.get('pkg-a')).toBe('major');
		expect(bumps.get('pkg-b')).toBe('major');
		expect(bumps.get('pkg-c')).toBe('major');
	});

	it('adds packages without existing bumps to the map', () => {
		const bumps = new Map<string, BumpType>([['pkg-a', 'patch']]);
		const group = ['pkg-a', 'pkg-b'];

		applyFixedGroup(bumps, group);

		expect(bumps.get('pkg-b')).toBe('patch');
		expect(bumps.size).toBe(2);
	});
});

describe('applyLinkedGroup', () => {
	it('aligns bumped packages to max bump', () => {
		const bumps = new Map<string, BumpType>([
			['pkg-a', 'patch'],
			['pkg-b', 'minor'],
		]);
		const group = ['pkg-a', 'pkg-b', 'pkg-c'];

		applyLinkedGroup(bumps, group);

		expect(bumps.get('pkg-a')).toBe('minor');
		expect(bumps.get('pkg-b')).toBe('minor');
	});

	it('does not add new packages that have no bumps', () => {
		const bumps = new Map<string, BumpType>([
			['pkg-a', 'patch'],
			['pkg-b', 'minor'],
		]);
		const group = ['pkg-a', 'pkg-b', 'pkg-c'];

		applyLinkedGroup(bumps, group);

		expect(bumps.has('pkg-c')).toBe(false);
		expect(bumps.size).toBe(2);
	});

	it('does nothing when no packages in the group have bumps', () => {
		const bumps = new Map<string, BumpType>([['pkg-x', 'major']]);
		const group = ['pkg-a', 'pkg-b'];

		applyLinkedGroup(bumps, group);

		expect(bumps.has('pkg-a')).toBe(false);
		expect(bumps.has('pkg-b')).toBe(false);
		expect(bumps.get('pkg-x')).toBe('major');
	});

	it('aligns to major when one package has major bump', () => {
		const bumps = new Map<string, BumpType>([
			['pkg-a', 'patch'],
			['pkg-b', 'major'],
			['pkg-c', 'minor'],
		]);
		const group = ['pkg-a', 'pkg-b', 'pkg-c'];

		applyLinkedGroup(bumps, group);

		expect(bumps.get('pkg-a')).toBe('major');
		expect(bumps.get('pkg-b')).toBe('major');
		expect(bumps.get('pkg-c')).toBe('major');
	});
});
