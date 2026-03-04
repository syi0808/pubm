import type { BumpType } from './parser.js';

export interface ChangelogEntry {
	summary: string;
	type: BumpType;
	id: string;
}

export interface DependencyUpdate {
	name: string;
	version: string;
}

const SECTION_ORDER: { type: BumpType; heading: string }[] = [
	{ type: 'major', heading: 'Major Changes' },
	{ type: 'minor', heading: 'Minor Changes' },
	{ type: 'patch', heading: 'Patch Changes' },
];

export function generateChangelog(
	version: string,
	entries: ChangelogEntry[],
	depUpdates?: DependencyUpdate[],
): string {
	const lines: string[] = [`## ${version}`];

	for (const section of SECTION_ORDER) {
		const sectionEntries = entries.filter((e) => e.type === section.type);
		if (sectionEntries.length === 0) continue;

		lines.push('');
		lines.push(`### ${section.heading}`);
		lines.push('');
		for (const entry of sectionEntries) {
			lines.push(`- ${entry.summary}`);
		}
	}

	if (depUpdates && depUpdates.length > 0) {
		lines.push('');
		lines.push('### Dependency Updates');
		lines.push('');
		for (const dep of depUpdates) {
			lines.push(`- Updated \`${dep.name}\` to ${dep.version}`);
		}
	}

	return `${lines.join('\n')}\n`;
}
