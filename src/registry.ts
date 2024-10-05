export abstract class Registry {
	abstract checkConnection(): Promise<boolean>;
	abstract getVersion(): Promise<string>;
	abstract getUsername(): Promise<string>;
	abstract publish(): Promise<boolean>;
}

export async function getRegistry() {
	return '';
}
