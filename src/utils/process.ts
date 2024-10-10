import process from 'node:process';

export function processExit(callback: () => unknown) {
	let called = false;

	const wrappedCallback = () => {
		if (called) return void 0;

		callback();

		called = true;
	};

	// Handled by ./listr.ts - externalSignalHandler
	// process.once('SIGINT', wrappedCallback);
	process.once('beforeExit', wrappedCallback);
	process.once('SIGTERM', wrappedCallback);
	process.once('exit', wrappedCallback);
	process.on('message', (message) => {
		if (message === 'shutdown') {
			wrappedCallback();
		}
	});
}
