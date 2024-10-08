import { exec } from 'tinyexec';

export class Git {
	async git(args: string[]) {
		return (await exec('git', args, { throwOnError: true })).stdout;
	}

	latestTag() {
		try {
			return this.git(['describe', '--tags', '--abbrev=0']);
		} catch {
			throw new Error('Failed to retrieve the latest tag on Git.');
		}
	}
}
