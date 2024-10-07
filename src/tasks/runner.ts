import { Listr } from 'listr2';
import type { ResolvedOptions } from '../types/options.js';
import { jsrPubmTasks } from './jsr.js';
import { npmPubmTasks } from './npm.js';
import { prerequisitesCheckTask } from './prerequisites-check.js';
import { requiredConditionsCheckTask } from './required-conditions-check.js';

export interface Ctx extends ResolvedOptions {
	progressingPrompt?: Promise<void>;
}

export async function run(options: ResolvedOptions) {
	const ctx = { ...options };

	try {
		await new Listr(prerequisitesCheckTask, {}).run(ctx);

		await new Listr([npmPubmTasks, jsrPubmTasks], {
			exitOnError: true,
			concurrent: true,
			ctx,
		}).run(ctx);
	} catch (e) {
		console.error(e);
	}
}
