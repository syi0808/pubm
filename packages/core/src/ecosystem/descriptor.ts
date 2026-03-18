export abstract class EcosystemDescriptor {
  constructor(public readonly path: string) {}
  abstract get displayName(): string;
  abstract get displayLabel(): string;
}
