import type { Readable, Writable } from 'node:stream';
import { stripVTControlCharacters } from 'node:util';
import { isCI } from 'std-env';
import { type Options, exec } from 'tinyexec';
import path from 'node:path';

// Based on https://github.com/vitest-dev/vitest/blob/main/test/test-utils/index.ts

type Listener = () => void;
type ReadableOrWritable = Readable | Writable;
type Source = 'stdout' | 'stderr';

export class CliController {
	stdout = '';
	stderr = '';

	private stdoutListeners: Listener[] = [];
	private stderrListeners: Listener[] = [];
	private stdin: ReadableOrWritable;

	constructor(options: {
		stdin: ReadableOrWritable;
		stdout: ReadableOrWritable;
		stderr: ReadableOrWritable;
	}) {
		this.stdin = options.stdin;

		for (const source of ['stdout', 'stderr'] as const) {
			const stream = options[source];

			if ((stream as Readable).readable) {
				stream.on('data', (data) => {
					this.capture(source, data);
				});
			} else if (isWritable(stream)) {
				const original = stream.write.bind(stream);

				// @ts-ignore
				stream.write = (data, encoding, callback) => {
					this.capture(source, data);
					return original(data, encoding, callback);
				};
			}
		}
	}

	private capture(source: Source, data: unknown): void {
		const msg = stripVTControlCharacters(`${data}`);
		this[source] += msg;

		for (const fn of this[`${source}Listeners`]) {
			fn();
		}
	}

	write(data: string): void {
		this.resetOutput();

		if ((this.stdin as Readable).readable) {
			this.stdin.emit('data', data);
		} else if (isWritable(this.stdin)) {
			this.stdin.write(data);
		}
	}

	resetOutput(): void {
		this.stdout = '';
		this.stderr = '';
	}

	waitForStdout(expected: string): Promise<void> {
		return this.waitForOutput(expected, 'stdout', this.waitForStdout);
	}

	waitForStderr(expected: string): Promise<void> {
		return this.waitForOutput(expected, 'stderr', this.waitForStderr);
	}

	private waitForOutput(
		expected: string,
		source: Source,
		caller: Parameters<typeof Error.captureStackTrace>[1],
	): Promise<void> {
		const error = new Error('Timeout');
		Error.captureStackTrace(error, caller);

		return new Promise<void>((resolve, reject) => {
			if (this[source].includes(expected)) {
				return resolve();
			}

			const timeout = setTimeout(
				() => {
					error.message = `Timeout when waiting for error "${expected}".\nReceived:\nstdout: ${this.stdout}\nstderr: ${this.stderr}`;
					reject(error);
				},
				isCI ? 20_000 : 4_000,
			);

			const listener = () => {
				if (this[source].includes(expected)) {
					if (timeout) {
						clearTimeout(timeout);
					}

					resolve();
				}
			};

			this[`${source}Listeners`].push(listener);
		});
	}
}

// biome-ignore lint/suspicious/noExplicitAny: <explanation>
function isWritable(stream: any): stream is Writable {
	return stream && typeof stream?.write === 'function';
}

export function runPubmCli(
	_options?: Partial<Options> | string,
	...args: string[]
): {
	controller: CliController;
	exitCode: number | undefined;
	stdout: string;
	stderr: string;
	waitForClose: () => Promise<unknown>;
} {
	let options = _options;

	if (typeof _options === 'string') {
		args.unshift(_options);
		options = undefined;
	}

	const subprocess = exec(path.resolve(import.meta.dirname, '../../bin/cli.js'), args, options as Options).process!;
	const controller = new CliController({
		// biome-ignore lint/style/noNonNullAssertion: <explanation>
		stdin: subprocess.stdin!,
		// biome-ignore lint/style/noNonNullAssertion: <explanation>
		stdout: subprocess.stdout!,
		// biome-ignore lint/style/noNonNullAssertion: <explanation>
		stderr: subprocess.stderr!,
	});

	const isDone = new Promise((resolve) => {
		subprocess?.on('exit', resolve);
	});

	return {
		controller,
		exitCode: subprocess?.exitCode ?? undefined,
		stdout: controller.stdout || '',
		stderr: controller.stderr || '',
		waitForClose: () => isDone,
	};
}

export const DOWN = '\x1B\x5B\x42';
export const UP = '\x1B\x5B\x41';
export const ENTER = '\x0D';
