import type { ListrTask } from 'listr2';
import { RustEcosystem } from '../ecosystem/rust.js';
import { AbstractError } from '../error.js';
import { CratesRegistry } from '../registry/crates.js';
import type { Ctx } from './runner.js';

class CratesError extends AbstractError {
	name = 'crates.io Error';

	constructor(message: string, { cause }: { cause?: unknown } = {}) {
		super(message, { cause });
		this.stack = '';
	}
}

async function getCrateName(): Promise<string> {
	const eco = new RustEcosystem(process.cwd());
	return await eco.packageName();
}

export const cratesAvailableCheckTasks: ListrTask<Ctx> = {
	title: 'Checking crates.io availability',
	task: async (): Promise<void> => {
		const packageName = await getCrateName();
		const registry = new CratesRegistry(packageName);

		if (!(await registry.isInstalled())) {
			throw new CratesError(
				'cargo is not installed. Please install Rust toolchain to proceed.',
			);
		}

		if (!(await registry.hasPermission())) {
			throw new CratesError(
				'No crates.io credentials found. Run `cargo login` or set CARGO_REGISTRY_TOKEN.',
			);
		}
	},
};

export const cratesPublishTasks: ListrTask<Ctx> = {
	title: 'Publishing to crates.io',
	task: async (): Promise<void> => {
		const packageName = await getCrateName();
		const registry = new CratesRegistry(packageName);

		await registry.publish();
	},
};
