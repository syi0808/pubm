export abstract class Registry {
	abstract ping(): Promise<boolean>;
	abstract distTags(): Promise<string[]>;
	abstract getVersion(): Promise<string>;
	abstract publish(): Promise<boolean>;
}
