import type { RegistryType } from '../types/options.js';
import type { Ecosystem } from './ecosystem.js';
import { JsEcosystem } from './js.js';
import { RustEcosystem } from './rust.js';

const registryToEcosystem: Record<string, new (path: string) => Ecosystem> = {
	npm: JsEcosystem,
	jsr: JsEcosystem,
	crates: RustEcosystem,
};

export async function detectEcosystem(
	packagePath: string,
	registries?: RegistryType[],
): Promise<Ecosystem | null> {
	if (registries?.length) {
		const EcoClass = registryToEcosystem[registries[0]];
		if (EcoClass) return new EcoClass(packagePath);
	}

	if (await RustEcosystem.detect(packagePath)) {
		return new RustEcosystem(packagePath);
	}

	if (await JsEcosystem.detect(packagePath)) {
		return new JsEcosystem(packagePath);
	}

	return null;
}

export { Ecosystem } from './ecosystem.js';
export { JsEcosystem } from './js.js';
export { RustEcosystem } from './rust.js';
