import { findOutFile } from './package';

type PackageManager = 'npm' | 'pnpm' | 'yarn';

const lockFile: Record<PackageManager, string[]> = {
	npm: ['package-lock.json', 'npm-shrinkwrap.json'],
	pnpm: ['pnpm-lock.yaml'],
	yarn: ['yarn.lock'],
};

export async function getPackageManager(): Promise<PackageManager> {
	for (const [packageManager, lockFiles] of Object.entries(lockFile)) {
		for (const lockFile of lockFiles) {
			if (await findOutFile(lockFile)) return packageManager as PackageManager;
		}
	}

	return 'npm';
}
