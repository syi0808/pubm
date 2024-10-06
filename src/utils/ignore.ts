import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import picomatch from 'picomatch';

async function getGitignorePatterns(gitignorePath: string) {
	try {
		const gitignoreContent = (await readFile(gitignorePath)).toString();

		return gitignoreContent
			.split('\n')
			.filter((line) => line && !line.startsWith('#'))
			.map((line) => line.trim());
	} catch {
		return [];
	}
}

export async function filesIgnoreWithGit(root: string) {
	const gitignorePatterns = await getGitignorePatterns(
		path.resolve(root, '.gitignore'),
	);

	if (gitignorePatterns.length <= 0) return [];

	const isIgnored = picomatch(gitignorePatterns, { dot: true });

	async function readDirRecursive(dir: string) {
		let results: string[] = [];

		const list = await readdir(dir);

		for (const file of list) {
			const filePath = path.resolve(dir, file);

			const fileStat = await stat(filePath);

			if (isIgnored(filePath)) return;

			if (fileStat?.isDirectory()) {
				const files = await readDirRecursive(filePath);

				if (files) results = [...results, ...files];
			} else {
				results.push(filePath);
			}
		}

		return results;
	}

	return readDirRecursive(root);
}
