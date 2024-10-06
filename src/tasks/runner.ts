import { Listr } from 'listr2';
import type { ResolvedOptions } from '../types/options';
import { jsrPubmTasks } from './jsr';
import { npmPubmTasks } from './npm';
import { prerequisiteTasks } from './prerequisites';

export interface Ctx extends ResolvedOptions {
	progressingPrompt?: Promise<void>;
}

export async function run(options: ResolvedOptions) {
	const ctx = { ...options };

	try {
		await prerequisiteTasks.run(ctx);

		await new Listr([npmPubmTasks, jsrPubmTasks], {
			exitOnError: true,
			concurrent: true,
			ctx,
		}).run(ctx);
	} catch (e) {
		console.error(e);
	}
}
