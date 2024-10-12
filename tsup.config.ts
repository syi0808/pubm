import { builtinModules } from 'node:module';
import { defineConfig } from 'tsup';

const external = [...builtinModules, ...builtinModules.map((n) => `node:${n}`)];
const noExternal = ['listr2'];

export default defineConfig([
	{
		entry: ['src/index.ts'],
		format: ['cjs', 'esm'],
		clean: true,
		dts: true,
		external,
		noExternal,
	},
	{
		entry: ['src/cli.ts'],
		format: 'esm',
		clean: true,
		outDir: './bin',
		external,
		noExternal,
		banner: {
			js: '#!/usr/bin/env node\n',
		},
	},
]);
