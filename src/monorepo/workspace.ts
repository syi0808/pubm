import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

export interface WorkspaceInfo {
	type: 'pnpm' | 'npm' | 'yarn';
	patterns: string[];
}

export function detectWorkspace(cwd?: string): WorkspaceInfo | null {
	const root = cwd ?? process.cwd();

	// 1. Check pnpm-workspace.yaml (highest priority)
	const pnpmWorkspacePath = join(root, 'pnpm-workspace.yaml');
	if (existsSync(pnpmWorkspacePath)) {
		const content = readFileSync(pnpmWorkspacePath, 'utf-8');
		const parsed = parse(content);
		const packages: string[] = parsed?.packages ?? [];
		return { type: 'pnpm', patterns: packages };
	}

	// 2. Check package.json workspaces field
	const packageJsonPath = join(root, 'package.json');
	if (existsSync(packageJsonPath)) {
		const content = readFileSync(packageJsonPath, 'utf-8');
		const pkg = JSON.parse(content);

		if (pkg.workspaces) {
			// Handle array format: "workspaces": ["packages/*"]
			if (Array.isArray(pkg.workspaces)) {
				return { type: 'npm', patterns: pkg.workspaces };
			}

			// Handle object format: "workspaces": { "packages": ["packages/*"] }
			if (
				typeof pkg.workspaces === 'object' &&
				Array.isArray(pkg.workspaces.packages)
			) {
				return { type: 'yarn', patterns: pkg.workspaces.packages };
			}
		}
	}

	// 3. None found
	return null;
}
