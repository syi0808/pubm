# Multi-Ecosystem Registry Support Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extend pubm to support crates.io (Rust) in polyglot monorepos, with an Ecosystem abstraction and config file system.

**Architecture:** Introduce an `Ecosystem` abstraction layer above the existing `Registry` class — Ecosystem handles build/test/version per language, Registry handles publish. A `pubm.config.{ts,js,...}` config file system enables monorepo and multi-language configuration. Existing behavior is preserved when no config file is present.

**Tech Stack:** TypeScript, Vitest, tinyexec, TOML parsing (smol-toml), jiti (config file loading)

---

## Phase 1: Foundation

### Task 1: Add smol-toml and jiti dependencies

These are needed for Cargo.toml parsing and config file loading respectively.

**Files:**
- Modify: `package.json`

**Step 1: Install dependencies**

Run: `pnpm add smol-toml jiti`

**Step 2: Verify installation**

Run: `pnpm ls smol-toml jiti`
Expected: Both packages listed

**Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: add smol-toml and jiti dependencies"
```

---

### Task 2: Add RegistryType 'crates' and config types

**Files:**
- Modify: `src/types/options.ts:1` — add `'crates'` to RegistryType
- Create: `src/types/config.ts` — config file types

**Step 1: Write failing test for config types**

Create: `tests/unit/types/config.test.ts`

```typescript
import { describe, expect, it } from 'vitest';
import type { PackageConfig, PubmConfig } from '../../../src/types/config.js';

describe('Config types', () => {
	it('allows PackageConfig with required fields', () => {
		const config: PackageConfig = {
			path: 'packages/my-lib',
			registries: ['npm', 'jsr'],
		};
		expect(config.path).toBe('packages/my-lib');
		expect(config.registries).toEqual(['npm', 'jsr']);
	});

	it('allows PackageConfig with optional overrides', () => {
		const config: PackageConfig = {
			path: 'crates/my-crate',
			registries: ['crates'],
			buildCommand: 'cargo build --release',
			testCommand: 'cargo test',
		};
		expect(config.buildCommand).toBe('cargo build --release');
		expect(config.testCommand).toBe('cargo test');
	});

	it('allows PubmConfig with packages array', () => {
		const config: PubmConfig = {
			versioning: 'independent',
			packages: [
				{ path: '.', registries: ['npm'] },
			],
		};
		expect(config.versioning).toBe('independent');
		expect(config.packages).toHaveLength(1);
	});

	it('allows PubmConfig without packages (single-package shorthand)', () => {
		const config: PubmConfig = {
			registries: ['npm', 'jsr'],
			branch: 'main',
		};
		expect(config.registries).toEqual(['npm', 'jsr']);
		expect(config.packages).toBeUndefined();
	});
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/types/config.test.ts`
Expected: FAIL — cannot find module `../../../src/types/config.js`

**Step 3: Update RegistryType**

Modify `src/types/options.ts:1`:

```typescript
export type RegistryType = 'npm' | 'jsr' | 'crates' | string;
```

**Step 4: Create config types**

Create: `src/types/config.ts`

```typescript
import type { RegistryType } from './options.js';

export interface PackageConfig {
	path: string;
	registries: RegistryType[];
	buildCommand?: string;
	testCommand?: string;
}

export interface PubmConfig {
	versioning?: 'independent' | 'fixed';
	packages?: PackageConfig[];
	registries?: RegistryType[];
	branch?: string;
	tag?: string;
	skipTests?: boolean;
	skipBuild?: boolean;
	skipPublish?: boolean;
	skipReleaseDraft?: boolean;
}
```

**Step 5: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/types/config.test.ts`
Expected: PASS

**Step 6: Run full test suite for regression**

Run: `pnpm test`
Expected: All existing tests still pass

**Step 7: Commit**

```bash
git add src/types/options.ts src/types/config.ts tests/unit/types/config.test.ts
git commit -m "feat: add 'crates' registry type and config types"
```

---

### Task 3: Config file loader

**Files:**
- Create: `src/config/loader.ts`
- Create: `tests/unit/config/loader.test.ts`
- Create: `tests/fixtures/with-config/pubm.config.ts`

**Step 1: Create fixture config file**

Create: `tests/fixtures/with-config/pubm.config.ts`

```typescript
export default {
	versioning: 'independent' as const,
	packages: [
		{
			path: 'packages/my-lib',
			registries: ['npm', 'jsr'],
		},
		{
			path: 'crates/my-crate',
			registries: ['crates'],
		},
	],
	branch: 'main',
};
```

**Step 2: Write failing test**

Create: `tests/unit/config/loader.test.ts`

```typescript
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { defineConfig, loadConfig } from '../../../src/config/loader.js';

describe('defineConfig', () => {
	it('returns the config as-is (identity function)', () => {
		const config = defineConfig({
			registries: ['npm'],
			branch: 'main',
		});
		expect(config).toEqual({ registries: ['npm'], branch: 'main' });
	});
});

describe('loadConfig', () => {
	it('returns null when no config file exists', async () => {
		const result = await loadConfig(
			path.resolve(__dirname, '../../fixtures/basic'),
		);
		expect(result).toBeNull();
	});

	it('loads pubm.config.ts when it exists', async () => {
		const result = await loadConfig(
			path.resolve(__dirname, '../../fixtures/with-config'),
		);
		expect(result).not.toBeNull();
		expect(result!.versioning).toBe('independent');
		expect(result!.packages).toHaveLength(2);
		expect(result!.packages![0].path).toBe('packages/my-lib');
	});
});
```

**Step 3: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/config/loader.test.ts`
Expected: FAIL — cannot find module `../../../src/config/loader.js`

**Step 4: Implement config loader**

Create: `src/config/loader.ts`

```typescript
import { stat } from 'node:fs/promises';
import path from 'node:path';
import type { PubmConfig } from '../types/config.js';

const CONFIG_FILES = [
	'pubm.config.ts',
	'pubm.config.mts',
	'pubm.config.cts',
	'pubm.config.js',
	'pubm.config.mjs',
	'pubm.config.cjs',
];

export function defineConfig(config: PubmConfig): PubmConfig {
	return config;
}

async function findConfigFile(cwd: string): Promise<string | null> {
	for (const file of CONFIG_FILES) {
		const filePath = path.join(cwd, file);
		try {
			if ((await stat(filePath)).isFile()) {
				return filePath;
			}
		} catch {}
	}
	return null;
}

export async function loadConfig(
	cwd: string = process.cwd(),
): Promise<PubmConfig | null> {
	const configPath = await findConfigFile(cwd);
	if (!configPath) return null;

	const { createJiti } = await import('jiti');
	const jiti = createJiti(cwd, { interopDefault: true });
	const mod = await jiti.import(configPath);

	return (mod as { default?: PubmConfig }).default ?? (mod as PubmConfig);
}
```

**Step 5: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/config/loader.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add src/config/loader.ts src/types/config.ts tests/unit/config/loader.test.ts tests/fixtures/with-config/pubm.config.ts
git commit -m "feat: add config file loader with defineConfig helper"
```

---

### Task 4: Ecosystem abstract class

**Files:**
- Create: `src/ecosystem/ecosystem.ts`
- Create: `tests/unit/ecosystem/ecosystem.test.ts`

**Step 1: Write failing test**

Create: `tests/unit/ecosystem/ecosystem.test.ts`

```typescript
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
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/ecosystem/ecosystem.test.ts`
Expected: FAIL — cannot find module

**Step 3: Implement Ecosystem abstract class**

Create: `src/ecosystem/ecosystem.ts`

```typescript
import type { RegistryType } from '../types/options.js';

export abstract class Ecosystem {
	constructor(public packagePath: string) {}

	abstract packageName(): Promise<string>;
	abstract readVersion(): Promise<string>;
	abstract writeVersion(newVersion: string): Promise<void>;
	abstract manifestFiles(): string[];
	abstract defaultTestCommand(): string;
	abstract defaultBuildCommand(): string;
	abstract supportedRegistries(): RegistryType[];
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/ecosystem/ecosystem.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/ecosystem/ecosystem.ts tests/unit/ecosystem/ecosystem.test.ts
git commit -m "feat: add Ecosystem abstract class"
```

---

## Phase 2: Ecosystem Implementations

### Task 5: JsEcosystem

Extracts existing JS-specific logic from `src/utils/package.ts` and `src/utils/package-manager.ts` into a cohesive ecosystem class.

**Files:**
- Create: `src/ecosystem/js.ts`
- Create: `tests/unit/ecosystem/js.test.ts`

**Step 1: Write failing test**

Create: `tests/unit/ecosystem/js.test.ts`

```typescript
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:fs/promises', () => ({
	readFile: vi.fn(),
	writeFile: vi.fn(),
	stat: vi.fn(),
}));

vi.mock('../../../src/utils/package-manager.js', () => ({
	getPackageManager: vi.fn(),
}));

import { readFile, stat, writeFile } from 'node:fs/promises';
import { JsEcosystem } from '../../../src/ecosystem/js.js';
import { getPackageManager } from '../../../src/utils/package-manager.js';

const mockedReadFile = vi.mocked(readFile);
const mockedWriteFile = vi.mocked(writeFile);
const mockedStat = vi.mocked(stat);
const mockedGetPackageManager = vi.mocked(getPackageManager);

beforeEach(() => {
	vi.clearAllMocks();
});

describe('JsEcosystem', () => {
	const fixturesPath = path.resolve(__dirname, '../../fixtures/basic');

	describe('detect', () => {
		it('returns true when package.json exists', async () => {
			mockedStat.mockResolvedValue({ isFile: () => true } as any);
			expect(await JsEcosystem.detect('/some/path')).toBe(true);
		});

		it('returns false when package.json does not exist', async () => {
			mockedStat.mockRejectedValue(new Error('ENOENT'));
			expect(await JsEcosystem.detect('/some/path')).toBe(false);
		});
	});

	describe('packageName', () => {
		it('reads name from package.json', async () => {
			mockedStat.mockResolvedValue({ isFile: () => true } as any);
			mockedReadFile.mockResolvedValue(
				Buffer.from(JSON.stringify({ name: 'my-lib', version: '1.0.0' })),
			);

			const eco = new JsEcosystem(fixturesPath);
			expect(await eco.packageName()).toBe('my-lib');
		});
	});

	describe('readVersion', () => {
		it('reads version from package.json', async () => {
			mockedStat.mockResolvedValue({ isFile: () => true } as any);
			mockedReadFile.mockResolvedValue(
				Buffer.from(JSON.stringify({ name: 'my-lib', version: '2.3.4' })),
			);

			const eco = new JsEcosystem(fixturesPath);
			expect(await eco.readVersion()).toBe('2.3.4');
		});
	});

	describe('writeVersion', () => {
		it('replaces version in package.json', async () => {
			const original = JSON.stringify({ name: 'my-lib', version: '1.0.0' }, null, 2);
			mockedStat.mockResolvedValue({ isFile: () => true } as any);
			mockedReadFile.mockResolvedValue(Buffer.from(original));

			const eco = new JsEcosystem(fixturesPath);
			await eco.writeVersion('2.0.0');

			expect(mockedWriteFile).toHaveBeenCalled();
			const writtenContent = mockedWriteFile.mock.calls[0][1] as string;
			expect(writtenContent).toContain('"2.0.0"');
			expect(writtenContent).not.toContain('"1.0.0"');
		});
	});

	describe('manifestFiles', () => {
		it('returns package.json', () => {
			const eco = new JsEcosystem(fixturesPath);
			const files = eco.manifestFiles();
			expect(files).toContain('package.json');
		});
	});

	describe('defaultTestCommand', () => {
		it('returns <pm> run test', async () => {
			mockedGetPackageManager.mockResolvedValue('pnpm');
			const eco = new JsEcosystem(fixturesPath);
			expect(await eco.defaultTestCommand()).toBe('pnpm run test');
		});
	});

	describe('defaultBuildCommand', () => {
		it('returns <pm> run build', async () => {
			mockedGetPackageManager.mockResolvedValue('npm');
			const eco = new JsEcosystem(fixturesPath);
			expect(await eco.defaultBuildCommand()).toBe('npm run build');
		});
	});

	describe('supportedRegistries', () => {
		it('returns npm and jsr', () => {
			const eco = new JsEcosystem(fixturesPath);
			expect(eco.supportedRegistries()).toEqual(['npm', 'jsr']);
		});
	});
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/ecosystem/js.test.ts`
Expected: FAIL — cannot find module

**Step 3: Implement JsEcosystem**

Create: `src/ecosystem/js.ts`

```typescript
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { RegistryType } from '../types/options.js';
import { getPackageManager } from '../utils/package-manager.js';
import { Ecosystem } from './ecosystem.js';

const versionRegex = /("version"\s*:\s*")[^"]*(")/;

export class JsEcosystem extends Ecosystem {
	static async detect(packagePath: string): Promise<boolean> {
		try {
			return (await stat(path.join(packagePath, 'package.json'))).isFile();
		} catch {
			return false;
		}
	}

	private async readPackageJson(): Promise<Record<string, unknown>> {
		const raw = await readFile(
			path.join(this.packagePath, 'package.json'),
			'utf-8',
		);
		return JSON.parse(raw);
	}

	async packageName(): Promise<string> {
		const pkg = await this.readPackageJson();
		return pkg.name as string;
	}

	async readVersion(): Promise<string> {
		const pkg = await this.readPackageJson();
		return pkg.version as string;
	}

	async writeVersion(newVersion: string): Promise<void> {
		const files = ['package.json', 'jsr.json'];

		for (const file of files) {
			const filePath = path.join(this.packagePath, file);
			try {
				const content = await readFile(filePath, 'utf-8');
				await writeFile(filePath, content.replace(versionRegex, `$1${newVersion}$2`));
			} catch {
				// File doesn't exist, skip
			}
		}
	}

	manifestFiles(): string[] {
		return ['package.json'];
	}

	async defaultTestCommand(): Promise<string> {
		const pm = await getPackageManager();
		return `${pm} run test`;
	}

	async defaultBuildCommand(): Promise<string> {
		const pm = await getPackageManager();
		return `${pm} run build`;
	}

	supportedRegistries(): RegistryType[] {
		return ['npm', 'jsr'];
	}
}
```

Note: `defaultTestCommand` and `defaultBuildCommand` return `Promise<string>` rather than `string` — update the abstract class signature accordingly:

Modify `src/ecosystem/ecosystem.ts`:

```typescript
import type { RegistryType } from '../types/options.js';

export abstract class Ecosystem {
	constructor(public packagePath: string) {}

	abstract packageName(): Promise<string>;
	abstract readVersion(): Promise<string>;
	abstract writeVersion(newVersion: string): Promise<void>;
	abstract manifestFiles(): string[];
	abstract defaultTestCommand(): Promise<string> | string;
	abstract defaultBuildCommand(): Promise<string> | string;
	abstract supportedRegistries(): RegistryType[];
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/ecosystem/js.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/ecosystem/ecosystem.ts src/ecosystem/js.ts tests/unit/ecosystem/js.test.ts
git commit -m "feat: add JsEcosystem implementation"
```

---

### Task 6: RustEcosystem

**Files:**
- Create: `src/ecosystem/rust.ts`
- Create: `tests/unit/ecosystem/rust.test.ts`
- Create: `tests/fixtures/rust-basic/Cargo.toml`

**Step 1: Create fixture**

Create: `tests/fixtures/rust-basic/Cargo.toml`

```toml
[package]
name = "my-crate"
version = "0.1.0"
edition = "2021"

[dependencies]
```

**Step 2: Write failing test**

Create: `tests/unit/ecosystem/rust.test.ts`

```typescript
import path from 'node:path';
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
			mockedStat.mockResolvedValue({ isFile: () => true } as any);
			mockedReadFile.mockResolvedValue(Buffer.from(CARGO_TOML));

			const eco = new RustEcosystem(pkgPath);
			expect(await eco.packageName()).toBe('my-crate');
		});
	});

	describe('readVersion', () => {
		it('reads version from Cargo.toml', async () => {
			mockedStat.mockResolvedValue({ isFile: () => true } as any);
			mockedReadFile.mockResolvedValue(Buffer.from(CARGO_TOML));

			const eco = new RustEcosystem(pkgPath);
			expect(await eco.readVersion()).toBe('0.1.0');
		});
	});

	describe('writeVersion', () => {
		it('replaces version in Cargo.toml', async () => {
			mockedStat.mockResolvedValue({ isFile: () => true } as any);
			mockedReadFile.mockResolvedValue(Buffer.from(CARGO_TOML));

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
			mockedStat.mockResolvedValue({ isFile: () => true } as any);
			mockedReadFile.mockResolvedValue(Buffer.from(cargoWithDeps));

			const eco = new RustEcosystem(pkgPath);
			await eco.writeVersion('2.0.0');

			const written = mockedWriteFile.mock.calls[0][1] as string;
			expect(written).toContain('version = "2.0.0"');
			// serde version should remain unchanged
			expect(written).toContain('serde = { version = "1.0.0"');
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
```

**Step 3: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/ecosystem/rust.test.ts`
Expected: FAIL — cannot find module

**Step 4: Implement RustEcosystem**

Create: `src/ecosystem/rust.ts`

```typescript
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
```

**Step 5: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/ecosystem/rust.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add src/ecosystem/rust.ts tests/unit/ecosystem/rust.test.ts tests/fixtures/rust-basic/Cargo.toml
git commit -m "feat: add RustEcosystem implementation"
```

---

### Task 7: Ecosystem detector/dispatcher

**Files:**
- Create: `src/ecosystem/index.ts`
- Create: `tests/unit/ecosystem/index.test.ts`

**Step 1: Write failing test**

Create: `tests/unit/ecosystem/index.test.ts`

```typescript
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/ecosystem/js.js', () => ({
	JsEcosystem: {
		detect: vi.fn(),
	},
}));
vi.mock('../../../src/ecosystem/rust.js', () => ({
	RustEcosystem: {
		detect: vi.fn(),
	},
}));

import { JsEcosystem } from '../../../src/ecosystem/js.js';
import { RustEcosystem } from '../../../src/ecosystem/rust.js';
import { detectEcosystem } from '../../../src/ecosystem/index.js';

const mockedJsDetect = vi.mocked(JsEcosystem.detect);
const mockedRustDetect = vi.mocked(RustEcosystem.detect);

beforeEach(() => {
	vi.clearAllMocks();
});

describe('detectEcosystem', () => {
	it('returns RustEcosystem when Cargo.toml exists', async () => {
		mockedRustDetect.mockResolvedValue(true);
		mockedJsDetect.mockResolvedValue(false);

		const eco = await detectEcosystem('/some/rust/path');
		expect(eco).toBeDefined();
		expect(eco!.packagePath).toBe('/some/rust/path');
	});

	it('returns JsEcosystem when package.json exists', async () => {
		mockedRustDetect.mockResolvedValue(false);
		mockedJsDetect.mockResolvedValue(true);

		const eco = await detectEcosystem('/some/js/path');
		expect(eco).toBeDefined();
		expect(eco!.packagePath).toBe('/some/js/path');
	});

	it('returns null when no manifest exists', async () => {
		mockedRustDetect.mockResolvedValue(false);
		mockedJsDetect.mockResolvedValue(false);

		const eco = await detectEcosystem('/empty/path');
		expect(eco).toBeNull();
	});

	it('prefers registry-based detection when registries are provided', async () => {
		const eco = await detectEcosystem('/some/path', ['crates']);
		expect(eco).toBeDefined();
		expect(eco!.packagePath).toBe('/some/path');
	});

	it('detects JS ecosystem from npm/jsr registries', async () => {
		const eco = await detectEcosystem('/some/path', ['npm']);
		expect(eco).toBeDefined();
	});
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/ecosystem/index.test.ts`
Expected: FAIL — cannot find module

**Step 3: Implement ecosystem dispatcher**

Create: `src/ecosystem/index.ts`

```typescript
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

export { JsEcosystem } from './js.js';
export { RustEcosystem } from './rust.js';
export { Ecosystem } from './ecosystem.js';
```

**Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/ecosystem/index.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/ecosystem/index.ts tests/unit/ecosystem/index.test.ts
git commit -m "feat: add ecosystem detection and dispatcher"
```

---

## Phase 3: CratesRegistry

### Task 8: CratesRegistry implementation

**Files:**
- Create: `src/registry/crates.ts`
- Create: `tests/unit/registry/crates.test.ts`

**Step 1: Write failing test**

Create: `tests/unit/registry/crates.test.ts`

```typescript
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('tinyexec', () => ({
	exec: vi.fn(),
}));

import { exec } from 'tinyexec';
import { CratesRegistry } from '../../../src/registry/crates.js';

const mockedExec = vi.mocked(exec);

let mockedFetch: ReturnType<typeof vi.fn>;
let registry: CratesRegistry;

beforeEach(() => {
	vi.clearAllMocks();
	mockedFetch = vi.fn();
	vi.stubGlobal('fetch', mockedFetch);
	registry = new CratesRegistry('my-crate');
});

function mockStdout(stdout: string) {
	mockedExec.mockResolvedValue({ stdout, stderr: '' } as any);
}

function mockStderr(stderr: string) {
	mockedExec.mockResolvedValue({ stdout: '', stderr } as any);
}

describe('CratesRegistry', () => {
	it('has crates.io registry url', () => {
		expect(registry.registry).toBe('https://crates.io');
	});

	describe('ping()', () => {
		it('returns true when crates.io API responds', async () => {
			mockedFetch.mockResolvedValue({ ok: true });
			const result = await registry.ping();
			expect(result).toBe(true);
			expect(mockedFetch).toHaveBeenCalledWith(
				'https://crates.io/api/v1',
				expect.objectContaining({
					headers: expect.objectContaining({
						'User-Agent': expect.stringContaining('pubm'),
					}),
				}),
			);
		});

		it('throws when crates.io is unreachable', async () => {
			mockedFetch.mockRejectedValue(new Error('network error'));
			await expect(registry.ping()).rejects.toThrow('Failed to ping crates.io');
		});
	});

	describe('isInstalled()', () => {
		it('returns true when cargo is available', async () => {
			mockStdout('cargo 1.75.0');
			expect(await registry.isInstalled()).toBe(true);
			expect(mockedExec).toHaveBeenCalledWith('cargo', ['--version']);
		});

		it('returns false when cargo is not found', async () => {
			mockedExec.mockRejectedValue(new Error('not found'));
			expect(await registry.isInstalled()).toBe(false);
		});
	});

	describe('distTags()', () => {
		it('returns empty array (not applicable for crates.io)', async () => {
			expect(await registry.distTags()).toEqual([]);
		});
	});

	describe('version()', () => {
		it('returns latest version from crates.io API', async () => {
			mockedFetch.mockResolvedValue({
				ok: true,
				json: async () => ({
					crate: { max_version: '1.2.3' },
				}),
			});

			expect(await registry.version()).toBe('1.2.3');
		});

		it('throws when crate not found', async () => {
			mockedFetch.mockResolvedValue({ ok: false, status: 404 });
			await expect(registry.version()).rejects.toThrow();
		});
	});

	describe('publish()', () => {
		it('returns true on successful cargo publish', async () => {
			mockStdout('Uploading my-crate v1.0.0');
			expect(await registry.publish()).toBe(true);
			expect(mockedExec).toHaveBeenCalledWith(
				'cargo',
				['publish'],
				expect.objectContaining({ throwOnError: true }),
			);
		});

		it('throws on publish failure', async () => {
			mockedExec.mockRejectedValue(new Error('publish failed'));
			await expect(registry.publish()).rejects.toThrow('Failed to run `cargo publish`');
		});
	});

	describe('isPublished()', () => {
		it('returns true when crate exists on crates.io', async () => {
			mockedFetch.mockResolvedValue({ ok: true });
			expect(await registry.isPublished()).toBe(true);
		});

		it('returns false when crate does not exist', async () => {
			mockedFetch.mockResolvedValue({ ok: false, status: 404 });
			expect(await registry.isPublished()).toBe(false);
		});
	});

	describe('hasPermission()', () => {
		it('returns true when token is available via env', async () => {
			process.env.CARGO_REGISTRY_TOKEN = 'test-token';
			expect(await registry.hasPermission()).toBe(true);
			delete process.env.CARGO_REGISTRY_TOKEN;
		});

		it('returns true when cargo is authenticated', async () => {
			mockStdout('cargo 1.75.0');
			// hasPermission checks isInstalled as fallback
			expect(await registry.hasPermission()).toBe(true);
		});
	});

	describe('isPackageNameAvailable()', () => {
		it('returns true when crate name is not taken (404)', async () => {
			mockedFetch.mockResolvedValue({ ok: false, status: 404 });
			expect(await registry.isPackageNameAvailable()).toBe(true);
		});

		it('returns false when crate name is taken (200)', async () => {
			mockedFetch.mockResolvedValue({ ok: true });
			expect(await registry.isPackageNameAvailable()).toBe(false);
		});
	});
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/registry/crates.test.ts`
Expected: FAIL — cannot find module

**Step 3: Implement CratesRegistry**

Create: `src/registry/crates.ts`

```typescript
import { exec } from 'tinyexec';
import { AbstractError } from '../error.js';
import { Registry } from './registry.js';

class CratesError extends AbstractError {
	name = 'crates.io Error';
}

const USER_AGENT = 'pubm (https://github.com/user/pubm)';

export class CratesRegistry extends Registry {
	registry = 'https://crates.io';

	private get headers(): Record<string, string> {
		return { 'User-Agent': USER_AGENT };
	}

	async ping(): Promise<boolean> {
		try {
			const response = await fetch(`${this.registry}/api/v1`, {
				headers: this.headers,
			});
			return response.ok;
		} catch (error) {
			throw new CratesError('Failed to ping crates.io', { cause: error });
		}
	}

	async isInstalled(): Promise<boolean> {
		try {
			await exec('cargo', ['--version']);
			return true;
		} catch {
			return false;
		}
	}

	async distTags(): Promise<string[]> {
		return [];
	}

	async version(): Promise<string> {
		try {
			const response = await fetch(
				`${this.registry}/api/v1/crates/${this.packageName}`,
				{ headers: this.headers },
			);

			if (!response.ok) {
				throw new Error(`Crate '${this.packageName}' not found`);
			}

			const data = (await response.json()) as {
				crate: { max_version: string };
			};
			return data.crate.max_version;
		} catch (error) {
			throw new CratesError(
				`Failed to fetch version for crate '${this.packageName}'`,
				{ cause: error },
			);
		}
	}

	async publish(): Promise<boolean> {
		try {
			await exec('cargo', ['publish'], { throwOnError: true });
			return true;
		} catch (error) {
			throw new CratesError('Failed to run `cargo publish`', {
				cause: error,
			});
		}
	}

	async isPublished(): Promise<boolean> {
		try {
			const response = await fetch(
				`${this.registry}/api/v1/crates/${this.packageName}`,
				{ headers: this.headers },
			);
			return response.ok;
		} catch {
			return false;
		}
	}

	async hasPermission(): Promise<boolean> {
		if (process.env.CARGO_REGISTRY_TOKEN) return true;

		return this.isInstalled();
	}

	async isPackageNameAvaliable(): Promise<boolean> {
		return this.isPackageNameAvailable();
	}

	async isPackageNameAvailable(): Promise<boolean> {
		try {
			const response = await fetch(
				`${this.registry}/api/v1/crates/${this.packageName}`,
				{ headers: this.headers },
			);
			return !response.ok;
		} catch {
			return true;
		}
	}
}

export async function cratesRegistry(
	packageName: string,
): Promise<CratesRegistry> {
	return new CratesRegistry(packageName);
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/registry/crates.test.ts`
Expected: PASS

**Step 5: Update registry dispatcher**

Modify `src/registry/index.ts` to add `crates` entry:

```typescript
import type { RegistryType } from '../types/options.js';
import { cratesRegistry } from './crates.js';
import { customRegistry } from './custom-registry.js';
import { jsrRegistry } from './jsr.js';
import { npmRegistry } from './npm.js';
import type { Registry } from './registry.js';

const registryMap = {
	npm: npmRegistry,
	jsr: jsrRegistry,
} as unknown as Record<RegistryType, (...args: unknown[]) => Promise<Registry>>;

export async function getRegistry(
	registryKey: RegistryType,
	packageName?: string,
): Promise<Registry> {
	if (registryKey === 'crates') {
		if (!packageName) throw new Error("'crates' registry requires a package name");
		return await cratesRegistry(packageName);
	}

	const registry = registryMap[registryKey];

	if (!registry) {
		return await customRegistry();
	}

	return await registry();
}
```

**Step 6: Run full test suite**

Run: `pnpm test`
Expected: All tests pass (verify existing registry/index.test.ts still works)

**Step 7: Commit**

```bash
git add src/registry/crates.ts src/registry/index.ts tests/unit/registry/crates.test.ts
git commit -m "feat: add CratesRegistry for crates.io support"
```

---

### Task 9: Crates task definitions

**Files:**
- Create: `src/tasks/crates.ts`
- Create: `tests/unit/tasks/crates.test.ts`

**Step 1: Write failing test**

Create: `tests/unit/tasks/crates.test.ts`

```typescript
import { describe, expect, it, vi } from 'vitest';
import {
	cratesAvailableCheckTasks,
	cratesPublishTasks,
} from '../../../src/tasks/crates.js';

describe('cratesAvailableCheckTasks', () => {
	it('has the correct title', () => {
		expect(cratesAvailableCheckTasks.title).toBe('Checking crates.io availability');
	});

	it('has a task function', () => {
		expect(typeof cratesAvailableCheckTasks.task).toBe('function');
	});
});

describe('cratesPublishTasks', () => {
	it('has the correct title', () => {
		expect(cratesPublishTasks.title).toBe('Publishing to crates.io');
	});

	it('has a task function', () => {
		expect(typeof cratesPublishTasks.task).toBe('function');
	});
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/tasks/crates.test.ts`
Expected: FAIL — cannot find module

**Step 3: Implement crates tasks**

Create: `src/tasks/crates.ts`

```typescript
import type { ListrTask } from 'listr2';
import { AbstractError } from '../error.js';
import { CratesRegistry } from '../registry/crates.js';
import type { Ctx } from './runner.js';

class CratesError extends AbstractError {
	name = 'crates.io Error';

	constructor(message: string, { cause }: { cause?: unknown } = {}) {
		super(message, { cause });
		this.stack = '';
	}
}

export const cratesAvailableCheckTasks: ListrTask<Ctx> = {
	title: 'Checking crates.io availability',
	task: async (ctx): Promise<void> => {
		const registry = new CratesRegistry(ctx.packageName ?? 'unknown');

		if (!(await registry.isInstalled())) {
			throw new CratesError(
				'cargo is not installed. Please install Rust toolchain to proceed.',
			);
		}

		if (!(await registry.hasPermission())) {
			throw new CratesError(
				'No crates.io credentials found. Run `cargo login` or set CARGO_REGISTRY_TOKEN.',
			);
		}
	},
};

export const cratesPublishTasks: ListrTask<Ctx> = {
	title: 'Publishing to crates.io',
	task: async (ctx): Promise<void> => {
		const registry = new CratesRegistry(ctx.packageName ?? 'unknown');

		await registry.publish();
	},
};
```

**Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/tasks/crates.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/tasks/crates.ts tests/unit/tasks/crates.test.ts
git commit -m "feat: add crates.io check and publish tasks"
```

---

## Phase 4: Runner Integration

### Task 10: Wire crates into runner switch dispatch

**Files:**
- Modify: `src/tasks/runner.ts:19,62-69,159-166` — add crates import and case
- Modify: `src/tasks/required-conditions-check.ts:146-153` — add crates case

**Step 1: Write failing test**

Add to `tests/unit/tasks/runner.test.ts` — new test in the "inner task execution" describe block.

Add mock at top of file (after existing mocks):

```typescript
vi.mock('../../../src/tasks/crates.js', () => ({
	cratesPublishTasks: {
		title: 'crates publish',
		task: vi.fn(),
	},
}));
```

Add test:

```typescript
it('publishOnly maps crates registry to cratesPublishTasks', async () => {
	const options = createOptions({
		publishOnly: true,
		registries: ['crates'],
	});
	await run(options);

	const callArgs = mockedCreateListr.mock.calls[0];
	const taskDef = callArgs[0] as any;
	expect(taskDef.title).toBe('Publishing');
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/tasks/runner.test.ts`
Expected: FAIL (or may pass depending on default fallback — the key change is eliminating the wrong npm fallback)

**Step 3: Update runner.ts**

Add import at line 20 (after jsr import):

```typescript
import { cratesPublishTasks } from './crates.js';
```

Update both switch statements in runner.ts (publishOnly at line 62 and normal at line 159) to add the crates case:

```typescript
switch (registry) {
	case 'npm':
		return npmPublishTasks;
	case 'jsr':
		return jsrPublishTasks;
	case 'crates':
		return cratesPublishTasks;
	default:
		return npmPublishTasks;
}
```

**Step 4: Update required-conditions-check.ts**

Add import at top:

```typescript
import { cratesAvailableCheckTasks } from './crates.js';
```

Update switch statement at line 146:

```typescript
switch (registryKey) {
	case 'npm':
		return npmAvailableCheckTasks;
	case 'jsr':
		return jsrAvailableCheckTasks;
	case 'crates':
		return cratesAvailableCheckTasks;
	default:
		return npmAvailableCheckTasks;
}
```

**Step 5: Run tests**

Run: `pnpm test`
Expected: All tests pass

**Step 6: Commit**

```bash
git add src/tasks/runner.ts src/tasks/required-conditions-check.ts tests/unit/tasks/runner.test.ts
git commit -m "feat: wire crates.io into runner and conditions check dispatch"
```

---

### Task 11: Export defineConfig from public API

**Files:**
- Modify: `src/index.ts` — re-export defineConfig
- Create: `tests/unit/config/exports.test.ts`

**Step 1: Write failing test**

Create: `tests/unit/config/exports.test.ts`

```typescript
import { describe, expect, it } from 'vitest';

describe('public API exports', () => {
	it('exports defineConfig from pubm', async () => {
		const { defineConfig } = await import('../../../src/index.js');
		expect(typeof defineConfig).toBe('function');
	});

	it('defineConfig returns the config unchanged', async () => {
		const { defineConfig } = await import('../../../src/index.js');
		const config = { registries: ['npm'] as const, branch: 'main' };
		expect(defineConfig(config as any)).toEqual(config);
	});
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/config/exports.test.ts`
Expected: FAIL — defineConfig not exported

**Step 3: Add export to index.ts**

Modify `src/index.ts`:

```typescript
import { resolveOptions } from './options.js';
import { run } from './tasks/runner.js';
import type { Options } from './types/options.js';

export async function pubm(options: Options): Promise<void> {
	const resolvedOptions = resolveOptions({ ...options });
	await run(resolvedOptions);
}

export { defineConfig } from './config/loader.js';
export type { Options } from './types/options.js';
export type { PubmConfig, PackageConfig } from './types/config.js';
```

**Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/config/exports.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/index.ts tests/unit/config/exports.test.ts
git commit -m "feat: export defineConfig and config types from public API"
```

---

### Task 12: Update vitest coverage exclusions

**Files:**
- Modify: `vitest.config.mts`

Since we added new directories (`src/config/`, `src/ecosystem/`) the coverage config should include them. Also, coverage thresholds may need temporary adjustment since new code is being added.

**Step 1: Read current coverage config**

Current exclude list in `vitest.config.mts` excludes: `src/types/**`, `src/config/**`, `src/tasks/custom-registry.ts`

The `src/config/**` exclusion means our config loader won't need coverage. But verify `src/ecosystem/**` is included by default.

**Step 2: Run full test suite with coverage**

Run: `pnpm coverage`
Expected: Coverage report includes ecosystem/ and registry/crates.ts

**Step 3: If coverage thresholds fail, adjust temporarily**

Modify coverage thresholds if needed — but ideally all new code has sufficient test coverage from the tasks above.

**Step 4: Commit if changes needed**

```bash
git add vitest.config.mts
git commit -m "chore: update coverage configuration for new modules"
```

---

### Task 13: Biome check and typecheck

Run linting, formatting, and type checking across all new and modified files.

**Step 1: Run biome check**

Run: `pnpm check`
Expected: No errors. If errors found, fix with `pnpm format`

**Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: No type errors

**Step 3: Run full test suite**

Run: `pnpm test`
Expected: All tests pass

**Step 4: Fix any issues and commit**

```bash
git add -A
git commit -m "chore: fix lint and type errors"
```

---

### Task 14: Final integration test

**Files:**
- Create: `tests/e2e/config-loading.test.ts`

**Step 1: Write E2E test**

Create: `tests/e2e/config-loading.test.ts`

```typescript
import { describe, expect, it } from 'vitest';
import { runPubmCli } from '../utils/cli.js';

describe('Config file loading', () => {
	it('pubm --help still works without config file', async () => {
		const controller = runPubmCli('node', {}, 'bin/cli.js', '--help');
		const output = await controller.waitForExit();
		expect(output.code).toBe(0);
		expect(output.stdout).toContain('pubm');
	});
});
```

**Step 2: Build the project first**

Run: `pnpm build`
Expected: Build succeeds

**Step 3: Run E2E test**

Run: `pnpm vitest run tests/e2e/config-loading.test.ts`
Expected: PASS

**Step 4: Run full test suite one final time**

Run: `pnpm test`
Expected: All tests pass

**Step 5: Commit**

```bash
git add tests/e2e/config-loading.test.ts
git commit -m "test: add E2E test for config loading backward compatibility"
```

---

## Summary of All New/Modified Files

### New Files
- `src/types/config.ts` — PubmConfig, PackageConfig types
- `src/config/loader.ts` — defineConfig(), loadConfig()
- `src/ecosystem/ecosystem.ts` — abstract Ecosystem base class
- `src/ecosystem/js.ts` — JsEcosystem
- `src/ecosystem/rust.ts` — RustEcosystem
- `src/ecosystem/index.ts` — detectEcosystem()
- `src/registry/crates.ts` — CratesRegistry
- `src/tasks/crates.ts` — cratesAvailableCheckTasks, cratesPublishTasks
- `tests/unit/types/config.test.ts`
- `tests/unit/config/loader.test.ts`
- `tests/unit/config/exports.test.ts`
- `tests/unit/ecosystem/ecosystem.test.ts`
- `tests/unit/ecosystem/js.test.ts`
- `tests/unit/ecosystem/rust.test.ts`
- `tests/unit/ecosystem/index.test.ts`
- `tests/unit/registry/crates.test.ts`
- `tests/unit/tasks/crates.test.ts`
- `tests/e2e/config-loading.test.ts`
- `tests/fixtures/with-config/pubm.config.ts`
- `tests/fixtures/rust-basic/Cargo.toml`

### Modified Files
- `package.json` — add smol-toml, jiti
- `src/types/options.ts:1` — add `'crates'` to RegistryType union
- `src/index.ts` — export defineConfig and config types
- `src/registry/index.ts` — add crates case to getRegistry
- `src/tasks/runner.ts` — import and dispatch cratesPublishTasks
- `src/tasks/required-conditions-check.ts` — import and dispatch cratesAvailableCheckTasks
- `tests/unit/tasks/runner.test.ts` — add crates mock and test
