import { describe, expect, test } from 'vitest';
import {
	getScope,
	getScopeAndName,
	isScopedPackage,
	isValidPackageName,
} from '../../src/utils/package-name';

describe('isScopedPackage', () => {
	test('returns true for valid scoped packages', () => {
		expect(isScopedPackage('@scope/package')).toBe(true);
		expect(isScopedPackage('@my-org/my-package')).toBe(true);
		expect(isScopedPackage('@user/lib-utils')).toBe(true);
	});

	test('returns false for non-scoped packages', () => {
		expect(isScopedPackage('package')).toBe(false);
		expect(isScopedPackage('my-package')).toBe(false);
		expect(isScopedPackage('lib-utils')).toBe(false);
	});

	test('returns false for invalid scoped package formats', () => {
		expect(isScopedPackage('@/package')).toBe(false);
		expect(isScopedPackage('@scope/')).toBe(false);
		expect(isScopedPackage('@scope')).toBe(false);
		expect(isScopedPackage('scope/package')).toBe(false);
	});
});

describe('getScope', () => {
	test('returns scope for scoped packages', () => {
		expect(getScope('@scope/package')).toBe('scope');
		expect(getScope('@my-org/my-package')).toBe('my-org');
		expect(getScope('@user/lib-utils')).toBe('user');
	});

	test('returns null for non-scoped packages', () => {
		expect(getScope('package')).toBe(null);
		expect(getScope('my-package')).toBe(null);
	});
});

describe('getScopeAndName', () => {
	test('returns scope and name for scoped packages', () => {
		expect(getScopeAndName('@scope/package')).toEqual(['scope', 'package']);
		expect(getScopeAndName('@myorg/mypackage')).toEqual(['myorg', 'mypackage']);
	});

	test('returns undefined strings for non-scoped packages', () => {
		expect(getScopeAndName('package')).toEqual(['undefined', 'undefined']);
	});
});

describe('isValidPackageName', () => {
	describe('valid package names', () => {
		test('accepts simple package names', () => {
			expect(isValidPackageName('package')).toBe(true);
			expect(isValidPackageName('my-package')).toBe(true);
			expect(isValidPackageName('my_package')).toBe(true);
			expect(isValidPackageName('package123')).toBe(true);
		});

		test('accepts scoped package names', () => {
			expect(isValidPackageName('@scope/package')).toBe(true);
			expect(isValidPackageName('@my-org/my-package')).toBe(true);
		});
	});

	describe('invalid package names', () => {
		test('rejects empty package names', () => {
			expect(isValidPackageName('')).toBe(false);
		});

		test('rejects package names starting with dot', () => {
			expect(isValidPackageName('.package')).toBe(false);
			expect(isValidPackageName('.hidden')).toBe(false);
		});

		test('rejects package names starting with underscore', () => {
			expect(isValidPackageName('_package')).toBe(false);
			expect(isValidPackageName('_private')).toBe(false);
		});

		test('rejects package names with leading/trailing whitespace', () => {
			expect(isValidPackageName(' package')).toBe(false);
			expect(isValidPackageName('package ')).toBe(false);
			expect(isValidPackageName(' package ')).toBe(false);
		});

		test('rejects blacklisted names', () => {
			expect(isValidPackageName('node_modules')).toBe(false);
			expect(isValidPackageName('favicon.ico')).toBe(false);
		});

		test('rejects builtin module names', () => {
			expect(isValidPackageName('fs')).toBe(false);
			expect(isValidPackageName('path')).toBe(false);
			expect(isValidPackageName('http')).toBe(false);
		});

		test('rejects package names longer than 214 characters', () => {
			const longName = 'a'.repeat(215);
			expect(isValidPackageName(longName)).toBe(false);
		});

		test('rejects package names with uppercase letters', () => {
			expect(isValidPackageName('Package')).toBe(false);
			expect(isValidPackageName('MyPackage')).toBe(false);
			expect(isValidPackageName('PACKAGE')).toBe(false);
		});

		test('rejects package names with special characters', () => {
			expect(isValidPackageName('package~name')).toBe(false);
			expect(isValidPackageName("package'name")).toBe(false);
			expect(isValidPackageName('package!name')).toBe(false);
			expect(isValidPackageName('package(name')).toBe(false);
			expect(isValidPackageName('package)name')).toBe(false);
			expect(isValidPackageName('package*name')).toBe(false);
		});
	});

	describe('edge cases', () => {
		test('accepts package names at exactly 214 characters', () => {
			const maxLengthName = 'a'.repeat(214);
			expect(isValidPackageName(maxLengthName)).toBe(true);
		});

		test('accepts package names with dots and hyphens', () => {
			expect(isValidPackageName('package.name')).toBe(true);
			expect(isValidPackageName('package-name')).toBe(true);
			expect(isValidPackageName('package.name-here')).toBe(true);
		});
	});
});
