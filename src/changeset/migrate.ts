import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

export interface MigrationResult {
	success: boolean;
	error?: string;
	migratedFiles: string[];
	configMigrated: boolean;
}

const SKIPPED_FILES = new Set(['config.json', 'README.md']);

export function migrateFromChangesets(
	cwd: string = process.cwd(),
): MigrationResult {
	const changesetDir = path.join(cwd, '.changeset');

	if (!existsSync(changesetDir)) {
		return {
			success: false,
			error: '.changeset/ directory not found',
			migratedFiles: [],
			configMigrated: false,
		};
	}

	const pubmDir = path.join(cwd, '.pubm', 'changesets');
	mkdirSync(pubmDir, { recursive: true });

	const files = readdirSync(changesetDir);
	const migratedFiles: string[] = [];
	let configMigrated = false;

	for (const file of files) {
		if (file === 'config.json') {
			configMigrated = true;
			continue;
		}

		if (SKIPPED_FILES.has(file)) {
			continue;
		}

		if (file.endsWith('.md') || file === 'pre.json') {
			const src = path.join(changesetDir, file);
			const dest = path.join(pubmDir, file);
			copyFileSync(src, dest);
			migratedFiles.push(file);
		}
	}

	return {
		success: true,
		migratedFiles,
		configMigrated,
	};
}
