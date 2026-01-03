import { describe, expect, test } from 'vitest';
import { warningBadge, link } from '../../src/utils/cli';

describe('warningBadge', () => {
	test('is a string containing Warning', () => {
		expect(typeof warningBadge).toBe('string');
		expect(warningBadge).toContain('Warning');
	});
});

describe('link', () => {
	test('creates hyperlink escape sequence', () => {
		const result = link('Click here', 'https://example.com');

		expect(result).toContain('https://example.com');
		expect(result).toContain('Click here');
		// OSC 8 escape sequence format
		expect(result).toContain('\u001B]8;;');
		expect(result).toContain('\u0007');
	});

	test('handles empty text', () => {
		const result = link('', 'https://example.com');

		expect(result).toContain('https://example.com');
	});

	test('handles empty url', () => {
		const result = link('text', '');

		expect(result).toContain('text');
	});
});
