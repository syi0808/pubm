import { exec } from 'tinyexec';

export class Git {
	async git(args: string[]) {
		return (await exec('git', args, { throwOnError: true })).stdout;
	}

	latestTag() {
		return this.git(['describe', '--tags', '--abbrev=0']);
	}
}
