declare module 'cac/deno/Option.js' {
	interface OptionConfig {
		default?: unknown;
		type?: (value: unknown) => unknown;
	}

	export type { OptionConfig };
}
