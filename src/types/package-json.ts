interface Dependency {
	[k: string]: string;
}

type Person = {
	name: string;
	url?: string;
	email?: string;
} & Record<string, unknown>;

export type PackageExportsEntryObject = {
	require?: PackageExportsEntry | PackageExportsFallback;
	import?: PackageExportsEntry | PackageExportsFallback;
	node?: PackageExportsEntry | PackageExportsFallback;
	default?: PackageExportsEntry | PackageExportsFallback;
	types?: PackageExportsEntry | PackageExportsFallback;
};

type PackageExportsEntry = PackageExportsEntryPath | PackageExportsEntryObject;
type PackageExportsEntryPath = string | null;
type PackageExportsFallback = PackageExportsEntry[];

export type Engine = 'node' | 'git' | 'npm' | 'pnpm' | 'yarn';

export interface PackageJson {
	name: string;
	version: string;
	description?: string;
	keywords?: string[];
	homepage?: string;
	bugs?:
		| {
				url?: string;
				email?: string;
				[k: string]: unknown;
		  }
		| string;
	license?: string;
	author?: Person;
	contributors?: Person[];
	maintainers?: Person[];
	files?: string[];
	main?: string;
	exports?:
		| string
		| ({
				'.'?: PackageExportsEntry | PackageExportsFallback;
		  } & Record<string, PackageExportsEntry | PackageExportsFallback>);
	bin?:
		| string
		| {
				[k: string]: string;
		  };
	type?: 'commonjs' | 'module';
	types?: string;
	typings?: string;
	typesVersions?: {
		[k: string]: {
			'*'?: string[];
		};
	};
	repository?:
		| {
				type?: string;
				url?: string;
				directory?: string;
				[k: string]: unknown;
		  }
		| string;
	scripts?: Record<string, string>;
	config?: {
		[k: string]: unknown;
	};
	dependencies?: Dependency;
	devDependencies?: Dependency;
	optionalDependencies?: Dependency;
	peerDependencies?: Dependency;
	packageManager?: string;
	engines?: Record<Engine, string>;
	preferGlobal?: boolean;
	private?: boolean | ('false' | 'true');
	publishConfig?: {
		access?: 'public' | 'restricted';
		tag?: string;
		registry?: string;
		[k: string]: unknown;
	};
	dist?: {
		shasum?: string;
		tarball?: string;
		[k: string]: unknown;
	};
	readme?: string;
	module?: string;
	[k: string]: unknown;
}
