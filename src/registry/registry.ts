export abstract class Registry {
	constructor(
		public packageName?: string,
		public registry?: string,
	) {}

	abstract ping(): Promise<boolean>;
	abstract distTags(): Promise<string[]>;
	abstract version(): Promise<string>;
	abstract publish(): Promise<boolean>;
	abstract isPublished(): Promise<boolean>;
	abstract hasPermission(): Promise<boolean>;
	abstract isPackageNameAvaliable(): Promise<boolean>;
}
