import { describe, expect, it } from 'vitest';
import { link, warningBadge } from '../../../src/utils/cli';

describe('warningBadge', () => {
	it('contains the text "Warning"', () => {
		expect(warningBadge).toContain('Warning');
	});

	it('contains " Warning " with surrounding spaces', () => {
		expect(warningBadge).toContain(' Warning ');
	});

	it('is a string', () => {
		expect(typeof warningBadge).toBe('string');
	});
});

describe('link', () => {
	it('produces a correct OSC 8 hyperlink escape sequence', () => {
		const result = link('click here', 'https://example.com');
		expect(result).toBe(
			'\u001B]8;;https://example.com\u0007click here\u001B]8;;\u0007',
		);
	});

	it('embeds the URL in the opening escape sequence', () => {
		const result = link('text', 'https://foo.bar');
		expect(result).toContain('\u001B]8;;https://foo.bar\u0007');
	});

	it('embeds the display text between the opening and closing sequences', () => {
		const result = link('my link text', 'https://example.com');
		expect(result).toContain('\u0007my link text\u001B]8;;\u0007');
	});

	it('ends with the closing OSC 8 sequence', () => {
		const result = link('text', 'https://example.com');
		expect(result.endsWith('\u001B]8;;\u0007')).toBe(true);
	});

	it('handles empty text', () => {
		const result = link('', 'https://example.com');
		expect(result).toBe('\u001B]8;;https://example.com\u0007\u001B]8;;\u0007');
	});

	it('handles empty URL', () => {
		const result = link('text', '');
		expect(result).toBe('\u001B]8;;\u0007text\u001B]8;;\u0007');
	});

	it('handles URLs with special characters', () => {
		const url = 'https://example.com/path?q=1&r=2#hash';
		const result = link('link', url);
		expect(result).toBe(`\u001B]8;;${url}\u0007link\u001B]8;;\u0007`);
	});
});
