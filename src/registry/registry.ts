export abstract class Registry {
	abstract ping(): Promise<boolean>;
	abstract getVersion(): Promise<string>;
	abstract publish(): Promise<boolean>;
}
