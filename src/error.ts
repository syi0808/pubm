import { color } from 'listr2';

export class AbstractError extends Error {
	cause?: unknown;

	constructor(message: string, { cause }: { cause?: unknown } = {}) {
		// @ts-ignore
		super(message, { cause });

		this.cause = cause;
	}
}

function replaceCode(code: string) {
	return code.replace(/`([^`].+)`/g, color.bold(color.underline('$1')));
}

function formatError(error: AbstractError | string): string {
	if (!(error instanceof Error)) return `${error}`;

	const message =
		typeof error.message === 'string'
			? replaceCode(error.message)
			: formatError(error);

	let stringifyError = `${color.bgRed(` ${error.name} `)}${color.reset('')} ${message}\n`;
	stringifyError += error.stack
		?.split('\n')
		.slice(1)
		.join('\n')
		.replace(/at/g, color.dim('at'))
		.replace(/\(([^\(].+)\)/g, color.blue('($1)'));

	if (error.cause) {
		stringifyError += '\n\nCaused: ';
		stringifyError += formatError(error.cause as AbstractError);
	}

	return stringifyError;
}

export function consoleError(error: string | Error) {
	let errorText = '\n';

	if (typeof error === 'string') {
		errorText += replaceCode(error);
	} else if (error instanceof Error) {
		errorText += formatError(error);
	} else {
		errorText += error;
	}

	console.error(`${errorText}\n`);
}
