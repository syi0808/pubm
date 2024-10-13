import type { Readable, Writable } from 'node:stream';
import { stripVTControlCharacters } from 'node:util';
import { isCI } from 'std-env';
import { exec, type Options } from 'tinyexec';

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

	private capture(source: Source, data: unknown) {
		const msg = stripVTControlCharacters(`${data}`);
		this[source] += msg;

		for (const fn of this[`${source}Listeners`]) {
			fn();
		}
	}

	write(data: string) {
		this.resetOutput();

		if ((this.stdin as Readable).readable) {
			this.stdin.emit('data', data);
		} else if (isWritable(this.stdin)) {
			this.stdin.write(data);
		}
	}

	resetOutput() {
		this.stdout = '';
		this.stderr = '';
	}

	waitForStdout(expected: string) {
		return this.waitForOutput(expected, 'stdout', this.waitForStdout);
	}

	waitForStderr(expected: string) {
		return this.waitForOutput(expected, 'stderr', this.waitForStderr);
	}

	private waitForOutput(
		expected: string,
		source: Source,
		caller: Parameters<typeof Error.captureStackTrace>[1],
	) {
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

export async function runPubmCli(
	command: string,
	_options?: Partial<Options>,
	...args: string[]
) {
	let options = _options;

	if (typeof _options === 'string') {
		args.unshift(_options);
		options = undefined;
	}

	const subprocess = exec(command, args, options as Options).process;
	const controller = new CliController({
		// biome-ignore lint/style/noNonNullAssertion: <explanation>
		stdin: subprocess!.stdin!,
		// biome-ignore lint/style/noNonNullAssertion: <explanation>
		stdout: subprocess!.stdout!,
		// biome-ignore lint/style/noNonNullAssertion: <explanation>
		stderr: subprocess!.stderr!,
	});

	let setDone: (value?: unknown) => void;

	const isDone = new Promise((resolve) => {
		setDone = resolve;
	});

	subprocess?.on('exit', () => setDone());

	function output() {
		return {
			controller,
			exitCode: subprocess?.exitCode,
			stdout: controller.stdout || '',
			stderr: controller.stderr || '',
			waitForClose: () => isDone,
		};
	}

	await isDone;

	return output();
}

export const DOWN = '\x1B\x5B\x42';
export const UP = '\x1B\x5B\x41';
export const ENTER = '\x0D';
