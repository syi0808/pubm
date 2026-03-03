import { describe, expect, it } from 'vitest';
import { Ecosystem } from '../../../src/ecosystem/ecosystem.js';
import type { RegistryType } from '../../../src/types/options.js';

class TestEcosystem extends Ecosystem {
	async packageName(): Promise<string> {
		return 'test-package';
	}
	async readVersion(): Promise<string> {
		return '1.0.0';
	}
	async writeVersion(_version: string): Promise<void> {}
	manifestFiles(): string[] {
		return ['test.json'];
	}
	defaultTestCommand(): string {
		return 'test-cmd';
	}
	defaultBuildCommand(): string {
		return 'build-cmd';
	}
	supportedRegistries(): RegistryType[] {
		return ['npm'];
	}
}

describe('Ecosystem', () => {
	it('can be instantiated via subclass', () => {
		const eco = new TestEcosystem('/some/path');
		expect(eco.packagePath).toBe('/some/path');
	});

	it('exposes all abstract methods through subclass', async () => {
		const eco = new TestEcosystem('/some/path');
		expect(await eco.packageName()).toBe('test-package');
		expect(await eco.readVersion()).toBe('1.0.0');
		expect(eco.manifestFiles()).toEqual(['test.json']);
		expect(eco.defaultTestCommand()).toBe('test-cmd');
		expect(eco.defaultBuildCommand()).toBe('build-cmd');
		expect(eco.supportedRegistries()).toEqual(['npm']);
	});
});
