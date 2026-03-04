import type { CAC } from 'cac';

export function registerVersionCommand(cli: CAC): void {
	cli
		.command('version', 'Consume changesets and bump versions')
		.action(async () => {
			console.log('pubm version — coming in next phase');
		});
}
