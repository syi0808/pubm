export abstract class Registry {
	abstract checkConnection(): Promise<boolean>;
	abstract checkPermission(): Promise<string>;
	abstract getVersion(): Promise<string>;
	abstract publish(): Promise<boolean>;
}
