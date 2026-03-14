export abstract class RegistryConnector {
  constructor(public registryUrl: string) {}
  abstract ping(): Promise<boolean>;
  abstract isInstalled(): Promise<boolean>;
  abstract version(): Promise<string>;
}
