import { stat } from 'node:fs/promises';
import path from 'node:path';
import type { PubmConfig } from '../types/config.js';

const CONFIG_FILES = [
	'pubm.config.ts',
	'pubm.config.mts',
	'pubm.config.cts',
	'pubm.config.js',
	'pubm.config.mjs',
	'pubm.config.cjs',
];

export function defineConfig(config: PubmConfig): PubmConfig {
	return config;
}

async function findConfigFile(cwd: string): Promise<string | null> {
	for (const file of CONFIG_FILES) {
		const filePath = path.join(cwd, file);
		try {
			if ((await stat(filePath)).isFile()) {
				return filePath;
			}
		} catch {}
	}
	return null;
}

export async function loadConfig(
	cwd: string = process.cwd(),
): Promise<PubmConfig | null> {
	const configPath = await findConfigFile(cwd);
	if (!configPath) return null;

	const { createJiti } = await import('jiti');
	const jiti = createJiti(cwd, { interopDefault: true });
	const mod = await jiti.import(configPath);

	return (mod as { default?: PubmConfig }).default ?? (mod as PubmConfig);
}
