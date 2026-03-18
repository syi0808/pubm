import { EcosystemDescriptor } from "./descriptor.js";

export class JsEcosystemDescriptor extends EcosystemDescriptor {
  constructor(
    path: string,
    public readonly npmName?: string,
    public readonly jsrName?: string,
  ) {
    super(path);
  }

  get displayName(): string {
    return this.npmName ?? this.jsrName ?? this.path;
  }

  get displayLabel(): string {
    if (this.npmName && this.jsrName && this.npmName !== this.jsrName) {
      return `${this.npmName} (${this.jsrName})`;
    }
    return this.displayName;
  }
}
