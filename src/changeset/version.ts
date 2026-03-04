import process from 'node:process';
import { inc } from 'semver';
import type { BumpType } from './parser.js';
import { readChangesets } from './reader.js';

export interface VersionBump {
	currentVersion: string;
	newVersion: string;
	bumpType: BumpType;
}

const BUMP_ORDER: Record<BumpType, number> = {
	patch: 0,
	minor: 1,
	major: 2,
};

function maxBumpType(a: BumpType, b: BumpType): BumpType {
	return BUMP_ORDER[a] >= BUMP_ORDER[b] ? a : b;
}

export function calculateVersionBumps(
	currentVersions: Map<string, string>,
	cwd: string = process.cwd(),
): Map<string, VersionBump> {
	const changesets = readChangesets(cwd);
	const bumpTypes = new Map<string, BumpType>();

	for (const changeset of changesets) {
		for (const release of changeset.releases) {
			if (!currentVersions.has(release.name)) continue;

			const existing = bumpTypes.get(release.name);
			if (existing) {
				bumpTypes.set(release.name, maxBumpType(existing, release.type));
			} else {
				bumpTypes.set(release.name, release.type);
			}
		}
	}

	const result = new Map<string, VersionBump>();

	for (const [name, bumpType] of bumpTypes) {
		const currentVersion = currentVersions.get(name);
		if (!currentVersion) continue;

		const newVersion = inc(currentVersion, bumpType);

		if (newVersion) {
			result.set(name, {
				currentVersion,
				newVersion,
				bumpType,
			});
		}
	}

	return result;
}
