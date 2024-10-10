import type { RegistryType } from '../types/options.js';
import { customRegistry } from './custom-registry.js';
import { jsrRegistry } from './jsr.js';
import { npmRegistry } from './npm.js';
import type { Registry } from './registry.js';

const registryMap = {
	npm: npmRegistry,
	jsr: jsrRegistry,
} as unknown as Record<RegistryType, () => Promise<Registry>>;

export async function getRegistry(registryKey: RegistryType) {
	const registry = registryMap[registryKey];

	if (!registry) {
		return await customRegistry();
	}

	return await registry();
}
