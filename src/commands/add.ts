import type { CAC } from 'cac';
import type { BumpType } from '../changeset/parser.js';
import { writeChangeset } from '../changeset/writer.js';

export function registerAddCommand(cli: CAC): void {
	cli
		.command('add', 'Create a new changeset')
		.option('--empty', 'Create an empty changeset')
		.option('--packages <list>', 'Comma-separated package names')
		.option('--bump <type>', 'Bump type: patch, minor, major')
		.option('--message <text>', 'Changeset summary')
		.action(
			async (options: {
				empty?: boolean;
				packages?: string;
				bump?: string;
				message?: string;
			}) => {
				if (options.empty) {
					const filePath = writeChangeset([], '');
					console.log(`Created empty changeset: ${filePath}`);
					return;
				}

				if (options.packages && options.bump && options.message) {
					const packages = options.packages
						.split(',')
						.map((p: string) => p.trim());
					const releases = packages.map((name: string) => ({
						name,
						type: options.bump as BumpType,
					}));
					const filePath = writeChangeset(releases, options.message);
					console.log(`Created changeset: ${filePath}`);
					return;
				}

				// Interactive mode placeholder
				console.log(
					'Interactive changeset creation coming soon. Use --packages, --bump, and --message flags for now.',
				);
			},
		);
}
