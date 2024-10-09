import { builtinModules } from 'node:module';
import { defineConfig } from 'tsup';

const external = [...builtinModules, ...builtinModules.map((n) => `node:${n}`)];

export default defineConfig([
	{
		entry: ['src/index.ts'],
		format: ['cjs', 'esm'],
		clean: true,
		dts: true,
		external,
	},
	{
		entry: ['src/cli.ts'],
		format: 'esm',
		clean: true,
		outDir: './bin',
		external,
	},
]);
