import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import path from 'node:path';

export interface PreState {
	mode: 'pre';
	tag: string;
	packages: Record<string, { baseVersion: string; iteration: number }>;
}

function getPreStatePath(cwd?: string): string {
	return path.resolve(cwd ?? process.cwd(), '.pubm', 'pre.json');
}

export function readPreState(cwd?: string): PreState | null {
	const filePath = getPreStatePath(cwd);

	if (!existsSync(filePath)) {
		return null;
	}

	const content = readFileSync(filePath, 'utf-8');
	return JSON.parse(content) as PreState;
}

export function enterPreMode(tag: string, cwd?: string): void {
	const filePath = getPreStatePath(cwd);

	if (existsSync(filePath)) {
		throw new Error(
			'Already in pre mode. Exit pre mode first before entering a new one.',
		);
	}

	const dir = path.dirname(filePath);
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}

	const state: PreState = {
		mode: 'pre',
		tag,
		packages: {},
	};

	writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf-8');
}

export function exitPreMode(cwd?: string): void {
	const filePath = getPreStatePath(cwd);

	if (!existsSync(filePath)) {
		throw new Error('Not in pre mode. Enter pre mode first before exiting.');
	}

	rmSync(filePath);
}
