import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse, stringify } from 'smol-toml';
import type { RegistryType } from '../types/options.js';
import { Ecosystem } from './ecosystem.js';

export class RustEcosystem extends Ecosystem {
	static async detect(packagePath: string): Promise<boolean> {
		try {
			return (await stat(path.join(packagePath, 'Cargo.toml'))).isFile();
		} catch {
			return false;
		}
	}

	private async readCargoToml(): Promise<Record<string, unknown>> {
		const raw = await readFile(
			path.join(this.packagePath, 'Cargo.toml'),
			'utf-8',
		);
		return parse(raw);
	}

	async packageName(): Promise<string> {
		const cargo = await this.readCargoToml();
		const pkg = cargo.package as Record<string, unknown>;
		return pkg.name as string;
	}

	async readVersion(): Promise<string> {
		const cargo = await this.readCargoToml();
		const pkg = cargo.package as Record<string, unknown>;
		return pkg.version as string;
	}

	async writeVersion(newVersion: string): Promise<void> {
		const filePath = path.join(this.packagePath, 'Cargo.toml');
		const raw = await readFile(filePath, 'utf-8');
		const cargo = parse(raw);

		const pkg = cargo.package as Record<string, unknown>;
		pkg.version = newVersion;

		await writeFile(filePath, stringify(cargo));
	}

	manifestFiles(): string[] {
		return ['Cargo.toml'];
	}

	defaultTestCommand(): string {
		return 'cargo test';
	}

	defaultBuildCommand(): string {
		return 'cargo build --release';
	}

	supportedRegistries(): RegistryType[] {
		return ['crates'];
	}
}
