export abstract class Registry {
	abstract ping(): Promise<boolean>;
	abstract distTags(): Promise<string[]>;
	abstract version(): Promise<string>;
	abstract publish(): Promise<boolean>;
}
