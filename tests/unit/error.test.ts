import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { AbstractError, consoleError } from '../../src/error';

describe('AbstractError', () => {
	test('creates error with message', () => {
		const error = new AbstractError('Test error message');

		expect(error.message).toBe('Test error message');
		expect(error.name).toBe('Error');
	});

	test('creates error with cause', () => {
		const cause = new Error('Original error');
		const error = new AbstractError('Wrapper error', { cause });

		expect(error.message).toBe('Wrapper error');
		expect(error.cause).toBe(cause);
	});

	test('is instance of Error', () => {
		const error = new AbstractError('Test error');

		expect(error).toBeInstanceOf(Error);
		expect(error).toBeInstanceOf(AbstractError);
	});

	test('has stack trace', () => {
		const error = new AbstractError('Test error');

		expect(error.stack).toBeDefined();
		expect(error.stack).toContain('Test error');
	});
});

describe('consoleError', () => {
	let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	afterEach(() => {
		consoleErrorSpy.mockRestore();
	});

	test('logs string errors', () => {
		consoleError('Simple error message');

		expect(consoleErrorSpy).toHaveBeenCalled();
		const output = consoleErrorSpy.mock.calls[0][0];
		expect(output).toContain('Simple error message');
	});

	test('logs Error instances', () => {
		const error = new Error('Error instance message');
		consoleError(error);

		expect(consoleErrorSpy).toHaveBeenCalled();
		const output = consoleErrorSpy.mock.calls[0][0];
		expect(output).toContain('Error instance message');
	});

	test('logs AbstractError instances', () => {
		const error = new AbstractError('Abstract error message');
		consoleError(error);

		expect(consoleErrorSpy).toHaveBeenCalled();
		const output = consoleErrorSpy.mock.calls[0][0];
		expect(output).toContain('Abstract error message');
	});

	test('formats code blocks in error messages', () => {
		const error = new AbstractError('Run `npm install` to fix');
		consoleError(error);

		expect(consoleErrorSpy).toHaveBeenCalled();
		const output = consoleErrorSpy.mock.calls[0][0];
		expect(output).toContain('npm install');
	});

	test('logs nested cause errors', () => {
		const cause = new Error('Root cause');
		const error = new AbstractError('Wrapper error', { cause });
		consoleError(error);

		expect(consoleErrorSpy).toHaveBeenCalled();
		const output = consoleErrorSpy.mock.calls[0][0];
		expect(output).toContain('Wrapper error');
		expect(output).toContain('Caused:');
		expect(output).toContain('Root cause');
	});

	test('handles non-string and non-error values', () => {
		// @ts-ignore - testing edge case
		consoleError(12345);

		expect(consoleErrorSpy).toHaveBeenCalled();
		const output = consoleErrorSpy.mock.calls[0][0];
		expect(output).toContain('12345');
	});

	test('handles undefined error', () => {
		// @ts-ignore - testing edge case
		consoleError(undefined);

		expect(consoleErrorSpy).toHaveBeenCalled();
	});

	test('handles null error', () => {
		// @ts-ignore - testing edge case
		consoleError(null);

		expect(consoleErrorSpy).toHaveBeenCalled();
	});
});
