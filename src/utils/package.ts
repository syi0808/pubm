import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { AbstractError } from '../error.js';
import type { JsrJson } from '../types/jsr-json.js';
import type {
	PackageExportsEntryObject,
	PackageJson,
} from '../types/package-json.js';
import { warningBadge } from './cli.js';

const cachedPackageJson: Record<string, PackageJson> = {};
const cachedJsrJson: Record<string, JsrJson> = {};

function findOutFile(file: string, { cwd = process.cwd() } = {}) {
	let directory = cwd;
	let filePath = '';
	const { root } = path.parse(cwd);

	while (directory && directory !== root) {
		filePath = path.join(directory, file);

		try {
			if (statSync(filePath).isFile()) {
				break;
			}
		} catch {}

		directory = path.dirname(directory);
	}

	return readFileSync(filePath).toString();
}

export function getPackageJson({
	cwd = process.cwd(),
	fallbackMode = false,
} = {}): PackageJson {
	if (cachedPackageJson[cwd]) return cachedPackageJson[cwd];

	try {
		const raw = findOutFile('package.json');

		if (!raw) {
			if (fallbackMode) {
				throw new Error(
					"Can't find either package.json or jsr.json. Please create one of them.",
				);
			}

			console.log(
				`${warningBadge} The 'jsr.json' cannot populate fields in 'package.json'. Please ensure other fields are manually filled out in 'package.json'`,
			);

			return jsrJsonToPackageJson(getJsrJson({ fallbackMode: true }));
		}

		const packageJson = JSON.parse(raw);
		cachedPackageJson[cwd] = packageJson;

		return packageJson as PackageJson;
	} catch (error) {
		throw new AbstractError(
			'The root package.json is not in valid JSON format. Please check the file for errors.',
			{ cause: error },
		);
	}
}

export function getJsrJson({
	cwd = process.cwd(),
	fallbackMode = false,
} = {}): JsrJson {
	if (cachedJsrJson[cwd]) return cachedJsrJson[cwd];

	try {
		const raw = findOutFile('jsr.json');

		if (!raw) {
			if (fallbackMode) {
				throw new Error(
					"Can't find either package.json or jsr.json. Please create one of them.",
				);
			}

			return packageJsonToJsrJson(getPackageJson({ fallbackMode: true }));
		}

		const jsrJson = JSON.parse(raw);
		cachedJsrJson[cwd] = jsrJson;

		return jsrJson as JsrJson;
	} catch (error) {
		throw new AbstractError(
			'The root jsr.json is not in valid JSON format. Please check the file for errors.',
			{ cause: error },
		);
	}
}

export function packageJsonToJsrJson(packageJson: PackageJson) {
	const ignore = findOutFile('.npmignore') || findOutFile('.gitignore');

	const ignores = ignore.split('\n').filter((v) => v);

	return <JsrJson>{
		name: packageJson.name,
		version: packageJson.version,
		exports:
			packageJson.exports &&
			convertExports(packageJson.exports as string | PackageExportsEntryObject),
		publish: {
			exclude: [
				...(packageJson.files?.filter((file) => file.startsWith('!')) ?? []),
				...ignores,
			],
			include: packageJson.files?.filter((file) => !file.startsWith('!')) ?? [],
		},
	};

	function convertExports(exports: string | PackageExportsEntryObject) {
		if (typeof exports === 'string') return exports;

		const convertedExports: Record<string, string | PackageExportsEntryObject> =
			{};

		for (const [exportKey, exportValue] of Object.entries(exports)) {
			convertedExports[exportKey] =
				typeof exportValue === 'string'
					? exportValue
					: convertExports(
							(exportValue as PackageExportsEntryObject).import as
								| string
								| PackageExportsEntryObject,
						);
		}

		return convertedExports;
	}
}

export function jsrJsonToPackageJson(jsrJson: JsrJson) {
	return <PackageJson>{
		name: jsrJson.name,
		version: jsrJson.version,
		files: [
			...(jsrJson.publish?.include ?? []),
			...(jsrJson.publish?.exclude?.map((v) => `!${v}`) ?? []),
		],
		exports: jsrJson.exports && convertExports(jsrJson.exports),
	};

	function convertExports(exports: string | Record<string, string>) {
		if (typeof exports === 'string') return exports;

		const convertedExports: Record<string, PackageExportsEntryObject> = {};

		for (const [exportKey, exportValue] of Object.entries(exports)) {
			convertedExports[exportKey] = {
				import: exportValue,
			};
		}

		return convertedExports;
	}
}

export function version({ cwd = process.cwd() } = {}) {
	let version = getPackageJson({ cwd })?.version;

	if (!version) {
		version = getJsrJson({ cwd })?.version;

		if (!version)
			throw new Error(
				"Can't find either package.json or jsr.json. Please create one of them.",
			);
	}

	return version;
}
