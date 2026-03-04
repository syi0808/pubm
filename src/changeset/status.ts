import process from 'node:process';
import type { BumpType, Changeset } from './parser.js';
import { readChangesets } from './reader.js';

export interface PackageStatus {
	bumpType: BumpType;
	changesetCount: number;
	summaries: string[];
}

export interface Status {
	packages: Map<string, PackageStatus>;
	changesets: Changeset[];
	hasChangesets: boolean;
}

const BUMP_ORDER: Record<BumpType, number> = {
	patch: 0,
	minor: 1,
	major: 2,
};

function maxBumpType(a: BumpType, b: BumpType): BumpType {
	return BUMP_ORDER[a] >= BUMP_ORDER[b] ? a : b;
}

export function getStatus(cwd: string = process.cwd()): Status {
	const changesets = readChangesets(cwd);
	const packages = new Map<string, PackageStatus>();

	for (const changeset of changesets) {
		for (const release of changeset.releases) {
			const existing = packages.get(release.name);

			if (existing) {
				existing.bumpType = maxBumpType(existing.bumpType, release.type);
				existing.changesetCount += 1;
				existing.summaries.push(changeset.summary);
			} else {
				packages.set(release.name, {
					bumpType: release.type,
					changesetCount: 1,
					summaries: [changeset.summary],
				});
			}
		}
	}

	return {
		packages,
		changesets,
		hasChangesets: changesets.length > 0,
	};
}
