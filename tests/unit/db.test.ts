import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { Db } from '../../src/utils/db';
import { rmSync } from 'node:fs';
import path from 'node:path';

describe('Db', () => {
	let db: Db;

	beforeEach(() => {
		db = new Db();
	});

	afterEach(() => {
		// Clean up the test db directory
		try {
			rmSync(db.path, { recursive: true, force: true });
		} catch {}
	});

	test('creates db instance with path', () => {
		expect(db).toBeDefined();
		expect(db.path).toContain('.pubm');
	});

	test('set and get value', () => {
		db.set('testKey', 'testValue');
		const result = db.get('testKey');

		expect(result).toBe('testValue');
	});

	test('set and get numeric value', () => {
		db.set('numKey', 12345);
		const result = db.get('numKey');

		expect(result).toBe('12345');
	});

	test('get returns null for non-existent key', () => {
		const result = db.get('nonExistentKey');

		expect(result).toBe(null);
	});

	test('overwrites existing value', () => {
		db.set('key', 'value1');
		db.set('key', 'value2');

		expect(db.get('key')).toBe('value2');
	});

	test('handles multiple keys', () => {
		db.set('key1', 'value1');
		db.set('key2', 'value2');
		db.set('key3', 'value3');

		expect(db.get('key1')).toBe('value1');
		expect(db.get('key2')).toBe('value2');
		expect(db.get('key3')).toBe('value3');
	});

	test('handles special characters in value', () => {
		db.set('special', 'value with spaces & special !@#$%^&*()');
		const result = db.get('special');

		expect(result).toBe('value with spaces & special !@#$%^&*()');
	});

	test('handles unicode characters', () => {
		db.set('unicode', '한글 테스트 🎉');
		const result = db.get('unicode');

		expect(result).toBe('한글 테스트 🎉');
	});
});
