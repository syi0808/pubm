import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['tests/**/*.{test,spec}.?(c|m)[jt]s?(x)'],
		coverage: {
			provider: 'v8',
			reporter: ['text', 'json-summary', 'json'],
			reportOnFailure: true,
		},
		passWithNoTests: true,
	},
});
