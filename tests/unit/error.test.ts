import { describe, expect, it, vi } from 'vitest';
import { AbstractError, consoleError } from '../../src/error.js';

describe('AbstractError', () => {
	it('should create an error with a message', () => {
		const error = new AbstractError('something went wrong');

		expect(error).toBeInstanceOf(Error);
		expect(error).toBeInstanceOf(AbstractError);
		expect(error.message).toBe('something went wrong');
		expect(error.name).toBe('Error');
	});

	it('should have an undefined cause by default', () => {
		const error = new AbstractError('no cause');

		expect(error.cause).toBeUndefined();
	});

	it('should accept a cause option', () => {
		const cause = new Error('root cause');
		const error = new AbstractError('wrapper', { cause });

		expect(error.cause).toBe(cause);
	});

	it('should accept a non-Error cause', () => {
		const error = new AbstractError('wrapper', { cause: 'string cause' });

		expect(error.cause).toBe('string cause');
	});

	it('should have a stack trace', () => {
		const error = new AbstractError('with stack');

		expect(error.stack).toBeDefined();
		expect(error.stack).toContain('with stack');
	});

	it('should support nested cause chains', () => {
		const root = new AbstractError('root');
		const middle = new AbstractError('middle', { cause: root });
		const top = new AbstractError('top', { cause: middle });

		expect(top.cause).toBe(middle);
		expect((top.cause as AbstractError).cause).toBe(root);
	});
});

describe('consoleError', () => {
	it('should call console.error with a string argument', () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

		consoleError('simple error message');

		expect(spy).toHaveBeenCalledOnce();
		const output = spy.mock.calls[0][0] as string;
		expect(output).toContain('simple error message');
	});

	it('should call console.error with an Error argument', () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const error = new Error('test error');

		consoleError(error);

		expect(spy).toHaveBeenCalledOnce();
		const output = spy.mock.calls[0][0] as string;
		expect(output).toContain('test error');
		expect(output).toContain('Error');
	});

	it('should call console.error with an AbstractError argument', () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const error = new AbstractError('abstract error');

		consoleError(error);

		expect(spy).toHaveBeenCalledOnce();
		const output = spy.mock.calls[0][0] as string;
		expect(output).toContain('abstract error');
	});

	it('should format an Error with a cause chain', () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const cause = new AbstractError('root cause');
		const error = new AbstractError('top level', { cause });

		consoleError(error);

		expect(spy).toHaveBeenCalledOnce();
		const output = spy.mock.calls[0][0] as string;
		expect(output).toContain('top level');
		expect(output).toContain('Caused:');
		expect(output).toContain('root cause');
	});

	it('should handle backtick-wrapped code in string messages', () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

		consoleError('Run `npm install` to fix');

		expect(spy).toHaveBeenCalledOnce();
		const output = spy.mock.calls[0][0] as string;
		// The backtick content should be transformed by replaceCode
		expect(output).not.toContain('`npm install`');
		expect(output).toContain('npm install');
	});

	it('should handle backtick-wrapped code in Error messages', () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const error = new Error('Run `npm publish` first');

		consoleError(error);

		expect(spy).toHaveBeenCalledOnce();
		const output = spy.mock.calls[0][0] as string;
		expect(output).not.toContain('`npm publish`');
		expect(output).toContain('npm publish');
	});

	it('should wrap output with leading and trailing newlines', () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

		consoleError('test');

		const output = spy.mock.calls[0][0] as string;
		expect(output.startsWith('\n')).toBe(true);
		expect(output.endsWith('\n')).toBe(true);
	});

	it('should handle a non-string non-Error value cast to Error type', () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

		// Force a non-string, non-Error value through the function.
		// TypeScript prevents this, but at runtime it is possible.
		consoleError(42 as unknown as string);

		expect(spy).toHaveBeenCalledOnce();
		const output = spy.mock.calls[0][0] as string;
		expect(output).toContain('42');
	});

	it('should include stack trace information in Error output', () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const error = new Error('stack test');

		consoleError(error);

		const output = spy.mock.calls[0][0] as string;
		// The formatted output should contain 'at' from the stack trace
		expect(output).toContain('at');
	});

	it('should format deeply nested cause chains', () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const level1 = new AbstractError('level 1');
		const level2 = new AbstractError('level 2', { cause: level1 });
		const level3 = new AbstractError('level 3', { cause: level2 });

		consoleError(level3);

		expect(spy).toHaveBeenCalledOnce();
		const output = spy.mock.calls[0][0] as string;
		expect(output).toContain('level 3');
		expect(output).toContain('level 2');
		expect(output).toContain('level 1');
	});
});
