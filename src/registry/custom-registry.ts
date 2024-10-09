import { exec } from 'tinyexec';
import { NpmRegistry } from './npm';

export class CustomRegistry extends NpmRegistry {
	async npm(args: string[]) {
		const { stdout, stderr } = await exec(
			'npm',
			args.concat('--registry', this.registry),
		);

		if (stderr) throw stderr;

		return stdout;
	}
}
