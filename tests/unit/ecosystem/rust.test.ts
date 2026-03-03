import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:fs/promises', () => ({
	readFile: vi.fn(),
	writeFile: vi.fn(),
	stat: vi.fn(),
}));

import { readFile, stat, writeFile } from 'node:fs/promises';
import { RustEcosystem } from '../../../src/ecosystem/rust.js';

const mockedReadFile = vi.mocked(readFile);
const mockedWriteFile = vi.mocked(writeFile);
const mockedStat = vi.mocked(stat);

beforeEach(() => {
	vi.clearAllMocks();
});

const CARGO_TOML = `[package]
name = "my-crate"
version = "0.1.0"
edition = "2021"

[dependencies]
`;

describe('RustEcosystem', () => {
	const pkgPath = '/fake/crate';

	describe('detect', () => {
		it('returns true when Cargo.toml exists', async () => {
			mockedStat.mockResolvedValue({ isFile: () => true } as any);
			expect(await RustEcosystem.detect(pkgPath)).toBe(true);
		});

		it('returns false when Cargo.toml does not exist', async () => {
			mockedStat.mockRejectedValue(new Error('ENOENT'));
			expect(await RustEcosystem.detect(pkgPath)).toBe(false);
		});
	});

	describe('packageName', () => {
		it('reads name from Cargo.toml', async () => {
			mockedReadFile.mockResolvedValue(CARGO_TOML as any);

			const eco = new RustEcosystem(pkgPath);
			expect(await eco.packageName()).toBe('my-crate');
		});
	});

	describe('readVersion', () => {
		it('reads version from Cargo.toml', async () => {
			mockedReadFile.mockResolvedValue(CARGO_TOML as any);

			const eco = new RustEcosystem(pkgPath);
			expect(await eco.readVersion()).toBe('0.1.0');
		});
	});

	describe('writeVersion', () => {
		it('replaces version in Cargo.toml', async () => {
			mockedReadFile.mockResolvedValue(CARGO_TOML as any);

			const eco = new RustEcosystem(pkgPath);
			await eco.writeVersion('1.0.0');

			expect(mockedWriteFile).toHaveBeenCalled();
			const written = mockedWriteFile.mock.calls[0][1] as string;
			expect(written).toContain('version = "1.0.0"');
			expect(written).not.toContain('version = "0.1.0"');
		});

		it('does not replace version in dependency sections', async () => {
			const cargoWithDeps = `[package]
name = "my-crate"
version = "0.1.0"
edition = "2021"

[dependencies]
serde = { version = "1.0.0", features = ["derive"] }
`;
			mockedReadFile.mockResolvedValue(cargoWithDeps as any);

			const eco = new RustEcosystem(pkgPath);
			await eco.writeVersion('2.0.0');

			const written = mockedWriteFile.mock.calls[0][1] as string;
			expect(written).toContain('version = "2.0.0"');
			// serde version should remain unchanged
			expect(written).toContain('version = "1.0.0"');
		});
	});

	describe('manifestFiles', () => {
		it('returns Cargo.toml', () => {
			const eco = new RustEcosystem(pkgPath);
			expect(eco.manifestFiles()).toEqual(['Cargo.toml']);
		});
	});

	describe('defaultTestCommand', () => {
		it('returns cargo test', () => {
			const eco = new RustEcosystem(pkgPath);
			expect(eco.defaultTestCommand()).toBe('cargo test');
		});
	});

	describe('defaultBuildCommand', () => {
		it('returns cargo build --release', () => {
			const eco = new RustEcosystem(pkgPath);
			expect(eco.defaultBuildCommand()).toBe('cargo build --release');
		});
	});

	describe('supportedRegistries', () => {
		it('returns crates', () => {
			const eco = new RustEcosystem(pkgPath);
			expect(eco.supportedRegistries()).toEqual(['crates']);
		});
	});
});
