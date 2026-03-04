import { parse as parseYaml } from 'yaml';

export type BumpType = 'patch' | 'minor' | 'major';

export interface Release {
	name: string;
	type: BumpType;
}

export interface Changeset {
	id: string;
	summary: string;
	releases: Release[];
}

export function parseChangeset(content: string, fileName: string): Changeset {
	const frontmatterRegex = /^---\n([\s\S]*?)---/;
	const match = content.match(frontmatterRegex);

	if (!match) {
		throw new Error(
			`Invalid changeset format in "${fileName}": missing frontmatter`,
		);
	}

	const yamlContent = match[1];
	const body = content.slice(match[0].length).trim();

	const parsed = parseYaml(yamlContent) as Record<string, string> | null;

	const releases: Release[] = [];

	if (parsed) {
		for (const [name, type] of Object.entries(parsed)) {
			releases.push({ name, type: type as BumpType });
		}
	}

	const id = fileName.replace(/\.md$/, '');

	return {
		id,
		summary: body,
		releases,
	};
}
