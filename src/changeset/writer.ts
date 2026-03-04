import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { stringify as stringifyYaml } from 'yaml';
import type { Release } from './parser.js';

const adjectives = [
	'brave',
	'calm',
	'dark',
	'eager',
	'fair',
	'glad',
	'happy',
	'idle',
	'jolly',
	'keen',
	'lame',
	'mild',
	'neat',
	'odd',
	'pale',
	'quick',
	'rare',
	'safe',
	'tall',
	'ugly',
	'vast',
	'warm',
	'young',
	'zany',
	'bold',
	'cool',
	'dry',
	'fast',
	'good',
	'hot',
	'icy',
	'loud',
];

const nouns = [
	'ant',
	'bear',
	'cat',
	'dog',
	'elk',
	'fox',
	'goat',
	'hawk',
	'ibis',
	'jay',
	'kite',
	'lion',
	'mole',
	'newt',
	'owl',
	'puma',
	'quail',
	'ram',
	'seal',
	'toad',
	'urchin',
	'vole',
	'wolf',
	'yak',
	'zebra',
	'ape',
	'bat',
	'cow',
	'deer',
	'emu',
	'frog',
	'gull',
];

export function generateChangesetId(): string {
	const adjective = adjectives[Math.floor(Math.random() * adjectives.length)];
	const noun = nouns[Math.floor(Math.random() * nouns.length)];
	return `${adjective}-${noun}`;
}

export function generateChangesetContent(
	releases: Release[],
	summary: string,
): string {
	let content = '---\n';

	if (releases.length > 0) {
		const yamlObj: Record<string, string> = {};
		for (const release of releases) {
			yamlObj[release.name] = release.type;
		}
		content += stringifyYaml(yamlObj);
	}

	content += '---\n';

	if (summary) {
		content += `\n${summary}\n`;
	}

	return content;
}

export function writeChangeset(
	releases: Release[],
	summary: string,
	cwd: string = process.cwd(),
): string {
	const changesetsDir = path.join(cwd, '.pubm', 'changesets');
	mkdirSync(changesetsDir, { recursive: true });

	const id = generateChangesetId();
	const fileName = `${id}.md`;
	const filePath = path.join(changesetsDir, fileName);
	const content = generateChangesetContent(releases, summary);

	writeFileSync(filePath, content, 'utf-8');

	return filePath;
}
