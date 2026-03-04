import { existsSync } from 'node:fs';
import path from 'node:path';

export interface EntryPointError {
	field: string;
	path: string;
}

const SIMPLE_FIELDS = ['main', 'module', 'types', 'typings'] as const;

function checkPath(filePath: string, cwd: string): boolean {
	return existsSync(path.resolve(cwd, filePath));
}

function validateExports(
	exports: unknown,
	cwd: string,
	prefix = 'exports',
): EntryPointError[] {
	const errors: EntryPointError[] = [];

	if (typeof exports === 'string') {
		if (!checkPath(exports, cwd)) {
			errors.push({ field: prefix, path: exports });
		}
		return errors;
	}

	if (typeof exports === 'object' && exports !== null) {
		for (const [key, value] of Object.entries(exports)) {
			if (typeof value === 'string') {
				if (!checkPath(value, cwd)) {
					errors.push({ field: `${prefix}["${key}"]`, path: value });
				}
			} else if (typeof value === 'object' && value !== null) {
				errors.push(...validateExports(value, cwd, `${prefix}["${key}"]`));
			}
		}
	}

	return errors;
}

export function validateEntryPoints(
	pkg: Record<string, unknown>,
	cwd: string,
): EntryPointError[] {
	const errors: EntryPointError[] = [];

	for (const field of SIMPLE_FIELDS) {
		const value = pkg[field];
		if (typeof value === 'string' && !checkPath(value, cwd)) {
			errors.push({ field, path: value });
		}
	}

	if (pkg.exports !== undefined) {
		errors.push(...validateExports(pkg.exports, cwd));
	}

	if (pkg.bin !== undefined) {
		if (typeof pkg.bin === 'string') {
			if (!checkPath(pkg.bin, cwd)) {
				errors.push({ field: 'bin', path: pkg.bin });
			}
		} else if (typeof pkg.bin === 'object' && pkg.bin !== null) {
			for (const [name, binPath] of Object.entries(
				pkg.bin as Record<string, string>,
			)) {
				if (!checkPath(binPath, cwd)) {
					errors.push({ field: `bin.${name}`, path: binPath });
				}
			}
		}
	}

	return errors;
}
