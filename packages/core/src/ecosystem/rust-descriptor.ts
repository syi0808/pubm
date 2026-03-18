import { EcosystemDescriptor } from "./descriptor.js";

export class RustEcosystemDescriptor extends EcosystemDescriptor {
  constructor(
    path: string,
    public readonly cratesName?: string,
  ) {
    super(path);
  }

  get displayName(): string {
    return this.cratesName ?? this.path;
  }

  get displayLabel(): string {
    return this.displayName;
  }
}
