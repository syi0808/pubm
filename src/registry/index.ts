import type { RegistryType } from '../types/options.js';
import { CustomRegistry } from './custom-registry.js';
import { JsrRegisry } from './jsr.js';
import { NpmRegistry } from './npm.js';
import type { Registry } from './registry.js';

const registryMap = {
	npm: NpmRegistry,
	jsr: JsrRegisry,
} as unknown as Record<RegistryType, typeof Registry>;

export const createRegistry = (registryName: RegistryType) => {
	return (...args: ConstructorParameters<typeof Registry>): Registry => {
		const Registry = registryMap[registryName];

		if (!Registry) {
			return new CustomRegistry(args[0], registryName);
		}

		// @ts-ignore
		return new Registry(args[0]);
	};
};
