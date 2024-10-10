import { builtinModules } from 'node:module';

export function isScopedPackage(packageName: string) {
	return /^@[^/]+\/[^@][\w.-]*$/.test(packageName);
}

export function getScope(packageName: string) {
	return packageName.match(/^@([^/]+)/)?.[1];
}

export function getScopeAndName(packageName: string) {
	const matches = packageName.match(/^@([a-zA-Z0-9]+)\/([a-zA-Z0-9]+)$/);
	const scope = matches?.[1];
	const name = matches?.[2];

	return [scope, name];
}

// Based on https://github.com/npm/validate-npm-package-name/blob/main/lib/index.js

const scopedPackagePattern = /^(?:@([^/]+?)[/])?([^/]+?)$/;
const blacklist = ['node_modules', 'favicon.ico'];

export function isValidPackageName(packageName: string) {
	if (packageName.length <= 0) return false;

	if (packageName.match(/^\./)) return false;

	if (packageName.match(/^_/)) return false;

	if (packageName.trim() !== packageName) return false;

	for (const blacklistedName of blacklist) {
		if (packageName.toLowerCase() === blacklistedName) return false;
	}

	if (builtinModules.includes(packageName.toLowerCase())) return false;

	if (packageName.length > 214) return false;

	if (packageName.toLowerCase() !== packageName) return false;

	if (/[~'!()*]/.test(packageName.split('/').slice(-1)[0])) return false;

	if (encodeURIComponent(packageName) !== packageName) {
		const matches = packageName.match(scopedPackagePattern);
		if (matches) {
			const scope = matches[1];
			const name = matches[2];
			if (
				encodeURIComponent(scope) === scope &&
				encodeURIComponent(name) === name
			) {
				return true;
			}
		}
	}

	return true;
}
