import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['tests/**/*.{test,spec}.?(c|m)[jt]s?(x)'],
		coverage: {
			provider: 'v8',
			reporter: ['text', 'json-summary', 'json'],
			reportOnFailure: true,
			include: ['src/**/*.ts'],
			exclude: [
				'src/types/**',
				'src/cli.ts',
				'src/tasks/**',
				'**/node_modules/**',
			],
		},
		passWithNoTests: true,
	},
});
