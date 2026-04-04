import type { RegistryType } from "../types/options.js";
import type { Ecosystem } from "./ecosystem.js";
import { JsEcosystem } from "./js.js";
import { RustEcosystem } from "./rust.js";

export type EcosystemKey = "js" | "rust" | string;

export interface EcosystemDescriptor {
  key: EcosystemKey;
  label: string;
  defaultRegistries: RegistryType[];
  ecosystemClass: new (path: string) => Ecosystem;
  detect: (packagePath: string) => Promise<boolean>;
}

export class EcosystemCatalog {
  private descriptors = new Map<EcosystemKey, EcosystemDescriptor>();

  register(descriptor: EcosystemDescriptor): void {
    this.descriptors.set(descriptor.key, descriptor);
  }

  get(key: EcosystemKey): EcosystemDescriptor | undefined {
    return this.descriptors.get(key);
  }

  async detect(packagePath: string): Promise<EcosystemDescriptor | null> {
    for (const descriptor of this.descriptors.values()) {
      if (await descriptor.detect(packagePath)) {
        return descriptor;
      }
    }
    return null;
  }

  all(): EcosystemDescriptor[] {
    return [...this.descriptors.values()];
  }

  remove(key: EcosystemKey): boolean {
    return this.descriptors.delete(key);
  }
}

export const ecosystemCatalog: EcosystemCatalog = new EcosystemCatalog();

ecosystemCatalog.register({
  key: "rust",
  label: "Rust",
  defaultRegistries: ["crates"],
  ecosystemClass: RustEcosystem,
  detect: (path) => RustEcosystem.detect(path),
});

ecosystemCatalog.register({
  key: "js",
  label: "JavaScript",
  defaultRegistries: ["npm", "jsr"],
  ecosystemClass: JsEcosystem,
  detect: (path) => JsEcosystem.detect(path),
});
