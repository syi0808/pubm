import { color } from 'listr2';
import { exec } from 'tinyexec';
import { getScopeAndName } from './package-name.js';
import { findOutFile, getJsrJson, getPackageJson, version } from './package.js';

export async function notifyNewVersion(): Promise<void> {
	const currentVersion = await version({ cwd: import.meta.dirname });

	await Promise.all([
		(async () => {
			try {
				const packageJson = await findOutFile('package.json', {
					cwd: import.meta.dirname,
				});

				if (!packageJson) return void 0;

				const { name } = await getPackageJson({
					cwd: import.meta.dirname,
					fallbackJsr: false,
				});

				const { stdout } = await exec('npm', ['info', name, 'version']);
				const newVersion = stdout.trim();

				if (newVersion !== currentVersion) {
					console.log(
						`\nUpdate available! \`${name}\` ${color.red(currentVersion)} → ${color.green(newVersion)}\n`,
					);
				}
			} catch {}
		})(),
		(async () => {
			try {
				const jsrJson = await findOutFile('jsr.json', {
					cwd: import.meta.dirname,
				});

				if (!jsrJson) return void 0;

				const { name } = await getJsrJson({
					cwd: import.meta.dirname,
					fallbackPackage: false,
				});

				const [scope, packageName] = getScopeAndName(name);

				const response = await fetch(
					`https://api.jsr.io/scopes/${scope}/packages/${packageName}/versions`,
				);
				const newVersion = (await response.json())?.[0]?.version;

				if (newVersion && newVersion !== currentVersion) {
					console.log(
						`\nUpdate available! \`${name}\` ${color.red(currentVersion)} → ${color.green(newVersion)}\n`,
					);
				}
			} catch {}
		})(),
	]);
}
