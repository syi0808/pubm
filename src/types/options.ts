export type RegistryType = 'npm' | 'jsr' | string;

export interface Options {
	/**
	 * @description Version to publish
	 */
	version: string;
	/**
	 * @description The npm script to run tests before publishing
	 * @default "test"
	 */
	testScript?: string;
	/**
	 * @description The npm script to run build before publishing
	 * @default "build"
	 */
	buildScript?: string;
	/**
	 * @description Run tasks without actually publishing
	 * @default false
	 */
	preview?: boolean;
	/**
	 * @description Target branch for the release
	 * @default "main"
	 */
	branch?: string;
	/**
	 * @description Allow publishing from any branch
	 * @default false
	 */
	anyBranch?: boolean;
	/**
	 * @description Skip cleaning the `node_modules` directory
	 * @default false
	 */
	skipCleanup?: boolean;
	/**
	 * @description Skip running tests before publishing
	 * @default false
	 */
	skipTests?: boolean;
	/**
	 * @description Skip build before publishing
	 * @default false
	 */
	skipBuild?: boolean;
	/**
	 * @description Skip publishing task
	 * @default false
	 */
	skipPublish?: boolean;
	/**
	 * @description Skip creating a GitHub release draft
	 * @default false
	 */
	skipReleaseDraft?: boolean;
	/**
	 * @description Skip prerequisites check task
	 * @default false
	 */
	skipPrerequisitesCheck?: boolean;
	/**
	 * @description Skip required conditions check task
	 * @default false
	 */
	skipConditionsCheck?: boolean;
	/**
	 * @description Skip both cleanup and tests
	 * @default false
	 */
	yolo?: boolean;
	/**
	 * @description Publish under a specific dist-tag
	 * @default "latest"
	 */
	tag?: string;
	/**
	 * @description Use a specific package manager
	 * @default 'packageManager' field in package.json or package manager configuration file
	 */
	packageManager?: string;
	/**
	 * @description Subdirectory to publish
	 */
	contents?: string;
	/**
	 * @description Target registries for publish
	 * @default ['npm', 'jsr']
	 */
	registries?: RegistryType[];
}

export interface ResolvedOptions extends Options {
	testScript: string;
	buildScript: string;
	packageManager: string;
	branch: string;
	tag: string;
	registries: RegistryType[];
}
