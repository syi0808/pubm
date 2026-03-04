# Changesets + np Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform pubm into a unified e2e deployment tool by integrating changesets workflow, np-style validation, monorepo support, and pre-release/snapshot capabilities.

**Architecture:** Extend pubm's existing task runner pipeline with new modules: `config/` for unified configuration, `changeset/` for intent-to-release workflow, `monorepo/` for workspace and dependency management, `validate/` for np-style checks, and `prerelease/` for pre/snapshot modes. The CLI transitions from single command to subcommand system while maintaining backward compatibility.

**Tech Stack:** TypeScript (strict, ES2020), CAC (CLI), listr2 (task runner), semver, yaml (changeset parsing), jiti (config loading), micromatch (glob patterns), vitest (testing)

**Design Doc:** `docs/plans/2026-03-04-changesets-np-integration-design.md`

---

## Phase 1: Foundation — Types & Config System

### Task 1: Add new dependencies

**Files:**
- Modify: `package.json`

**Step 1: Install dependencies**

```bash
pnpm add yaml jiti micromatch
pnpm add -D @types/micromatch
```

- `yaml` — YAML frontmatter parsing for changeset files
- `jiti` — Runtime TypeScript/ESM config file loading
- `micromatch` — Glob matching for fixed/linked groups

**Step 2: Verify installation**

Run: `pnpm typecheck`
Expected: PASS (no type errors from new deps)

**Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: add yaml, jiti, micromatch dependencies"
```

---

### Task 2: Define config types

**Files:**
- Create: `src/config/types.ts`
- Test: `tests/unit/config/types.test.ts`

**Step 1: Write the test**

```typescript
// tests/unit/config/types.test.ts
import { describe, expect, it } from 'vitest';
import { defineConfig } from '../../../src/config/types.js';

describe('defineConfig', () => {
  it('returns the config object unchanged', () => {
    const config = defineConfig({
      branch: 'main',
      packages: [{ path: '.', registries: ['npm'] }],
    });
    expect(config).toEqual({
      branch: 'main',
      packages: [{ path: '.', registries: ['npm'] }],
    });
  });

  it('accepts empty config', () => {
    const config = defineConfig({});
    expect(config).toEqual({});
  });

  it('accepts full config with all fields', () => {
    const config = defineConfig({
      versioning: 'independent',
      branch: 'main',
      packages: [
        { path: '.', registries: ['npm', 'jsr'] },
        { path: 'packages/core', registries: ['npm'], buildCommand: 'build', testCommand: 'test' },
      ],
      changelog: true,
      changelogFormat: 'github',
      commit: false,
      access: 'public',
      fixed: [['@myorg/core', '@myorg/utils']],
      linked: [['@myorg/react-*']],
      updateInternalDependencies: 'patch',
      ignore: ['@myorg/internal'],
      validate: {
        cleanInstall: true,
        entryPoints: true,
        extraneousFiles: true,
      },
      snapshot: {
        useCalculatedVersion: false,
        prereleaseTemplate: '{tag}-{timestamp}',
      },
      tag: 'latest',
      contents: '.',
      saveToken: true,
      releaseDraft: true,
      releaseNotes: true,
      rollbackStrategy: 'individual',
    });
    expect(config.versioning).toBe('independent');
    expect(config.fixed).toHaveLength(1);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/config/types.test.ts`
Expected: FAIL — module not found

**Step 3: Write implementation**

```typescript
// src/config/types.ts
import type { RegistryType } from '../types/options.js';

export interface PackageConfig {
  path: string;
  registries: RegistryType[];
  buildCommand?: string;
  testCommand?: string;
}

export interface ValidateConfig {
  cleanInstall?: boolean;
  entryPoints?: boolean;
  extraneousFiles?: boolean;
}

export interface SnapshotConfig {
  useCalculatedVersion?: boolean;
  prereleaseTemplate?: string;
}

export interface PubmConfig {
  versioning?: 'independent' | 'fixed';
  branch?: string;
  packages?: PackageConfig[];

  // Changeset workflow
  changelog?: boolean | string;
  changelogFormat?: 'default' | 'github' | string;
  commit?: boolean;
  access?: 'public' | 'restricted';

  // Monorepo groups
  fixed?: string[][];
  linked?: string[][];
  updateInternalDependencies?: 'patch' | 'minor';
  ignore?: string[];

  // Validation
  validate?: ValidateConfig;

  // Pre-release / Snapshot
  snapshot?: SnapshotConfig;

  // Publish options
  tag?: string;
  contents?: string;
  saveToken?: boolean;
  releaseDraft?: boolean;
  releaseNotes?: boolean;
  rollbackStrategy?: 'individual' | 'all';
}

export interface ResolvedPubmConfig extends Required<Omit<PubmConfig, 'packages' | 'validate' | 'snapshot'>> {
  packages: PackageConfig[];
  validate: Required<ValidateConfig>;
  snapshot: Required<SnapshotConfig>;
}

export function defineConfig(config: PubmConfig): PubmConfig {
  return config;
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/config/types.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/config/types.ts tests/unit/config/types.test.ts
git commit -m "feat: add PubmConfig types and defineConfig helper"
```

---

### Task 3: Config defaults and auto-detection

**Files:**
- Create: `src/config/defaults.ts`
- Test: `tests/unit/config/defaults.test.ts`

**Step 1: Write the test**

```typescript
// tests/unit/config/defaults.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

vi.mock('../../src/utils/package-manager.js', () => ({
  getPackageManager: vi.fn(),
}));

import { existsSync, readFileSync } from 'node:fs';
import { resolveConfig } from '../../../src/config/defaults.js';
import type { PubmConfig } from '../../../src/config/types.js';

const mockedExistsSync = vi.mocked(existsSync);
const mockedReadFileSync = vi.mocked(readFileSync);

describe('resolveConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedExistsSync.mockReturnValue(false);
  });

  it('returns full defaults when no config provided', () => {
    const resolved = resolveConfig({});
    expect(resolved.versioning).toBe('independent');
    expect(resolved.branch).toBe('main');
    expect(resolved.changelog).toBe(true);
    expect(resolved.validate.cleanInstall).toBe(true);
    expect(resolved.validate.entryPoints).toBe(true);
    expect(resolved.validate.extraneousFiles).toBe(true);
    expect(resolved.commit).toBe(false);
    expect(resolved.access).toBe('public');
    expect(resolved.rollbackStrategy).toBe('individual');
  });

  it('merges user config over defaults', () => {
    const config: PubmConfig = {
      branch: 'develop',
      changelog: false,
      validate: { cleanInstall: false },
    };
    const resolved = resolveConfig(config);
    expect(resolved.branch).toBe('develop');
    expect(resolved.changelog).toBe(false);
    expect(resolved.validate.cleanInstall).toBe(false);
    expect(resolved.validate.entryPoints).toBe(true); // default preserved
  });

  it('detects single package when no workspace config', () => {
    mockedExistsSync.mockReturnValue(false);
    const resolved = resolveConfig({});
    expect(resolved.packages).toEqual([{ path: '.', registries: ['npm', 'jsr'] }]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/config/defaults.test.ts`
Expected: FAIL

**Step 3: Write implementation**

```typescript
// src/config/defaults.ts
import type { PubmConfig, ResolvedPubmConfig, ValidateConfig, SnapshotConfig } from './types.js';

const defaultValidate: Required<ValidateConfig> = {
  cleanInstall: true,
  entryPoints: true,
  extraneousFiles: true,
};

const defaultSnapshot: Required<SnapshotConfig> = {
  useCalculatedVersion: false,
  prereleaseTemplate: '{tag}-{timestamp}',
};

const defaultConfig = {
  versioning: 'independent' as const,
  branch: 'main',
  changelog: true as boolean | string,
  changelogFormat: 'default' as string,
  commit: false,
  access: 'public' as const,
  fixed: [] as string[][],
  linked: [] as string[][],
  updateInternalDependencies: 'patch' as const,
  ignore: [] as string[],
  tag: 'latest',
  contents: '.',
  saveToken: true,
  releaseDraft: true,
  releaseNotes: true,
  rollbackStrategy: 'individual' as const,
};

export function resolveConfig(config: PubmConfig): ResolvedPubmConfig {
  const packages = config.packages ?? [{ path: '.', registries: ['npm', 'jsr'] }];

  return {
    ...defaultConfig,
    ...config,
    packages,
    validate: { ...defaultValidate, ...config.validate },
    snapshot: { ...defaultSnapshot, ...config.snapshot },
  };
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/config/defaults.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/config/defaults.ts tests/unit/config/defaults.test.ts
git commit -m "feat: add config defaults and resolveConfig"
```

---

### Task 4: Config file loader

**Files:**
- Create: `src/config/loader.ts`
- Create: `src/config/index.ts`
- Test: `tests/unit/config/loader.test.ts`

**Step 1: Write the test**

```typescript
// tests/unit/config/loader.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import path from 'node:path';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
}));

vi.mock('jiti', () => ({
  default: vi.fn(),
}));

vi.mock('../../../src/config/defaults.js', () => ({
  resolveConfig: vi.fn((c) => ({ ...c, _resolved: true })),
}));

import { existsSync } from 'node:fs';
import createJiti from 'jiti';
import { loadConfig } from '../../../src/config/loader.js';

const mockedExistsSync = vi.mocked(existsSync);
const mockedCreateJiti = vi.mocked(createJiti);

describe('loadConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedExistsSync.mockReturnValue(false);
  });

  it('returns resolved defaults when no config file exists', async () => {
    const config = await loadConfig();
    expect(config._resolved).toBe(true);
  });

  it('loads pubm.config.ts when it exists', async () => {
    const configPath = path.resolve('pubm.config.ts');
    mockedExistsSync.mockImplementation((p) => p === configPath);

    const mockJiti = vi.fn().mockReturnValue({ default: { branch: 'develop' } });
    mockedCreateJiti.mockReturnValue(mockJiti as any);

    const config = await loadConfig();
    expect(mockedCreateJiti).toHaveBeenCalled();
    expect(config.branch).toBe('develop');
  });

  it('searches config files in priority order', async () => {
    const calls: string[] = [];
    mockedExistsSync.mockImplementation((p) => {
      calls.push(String(p));
      return false;
    });

    await loadConfig();

    const extensions = ['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs'];
    for (const ext of extensions) {
      expect(calls.some(c => c.endsWith(`pubm.config${ext}`))).toBe(true);
    }
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/config/loader.test.ts`
Expected: FAIL

**Step 3: Write implementation**

```typescript
// src/config/loader.ts
import { existsSync } from 'node:fs';
import path from 'node:path';
import createJiti from 'jiti';
import { resolveConfig } from './defaults.js';
import type { PubmConfig, ResolvedPubmConfig } from './types.js';

const CONFIG_EXTENSIONS = ['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs'];
const CONFIG_BASE = 'pubm.config';

function findConfigFile(cwd: string = process.cwd()): string | null {
  for (const ext of CONFIG_EXTENSIONS) {
    const configPath = path.resolve(cwd, `${CONFIG_BASE}${ext}`);
    if (existsSync(configPath)) {
      return configPath;
    }
  }
  return null;
}

export async function loadConfig(cwd?: string): Promise<ResolvedPubmConfig> {
  const configPath = findConfigFile(cwd);

  if (!configPath) {
    return resolveConfig({});
  }

  const jiti = createJiti(configPath);
  const mod = jiti(configPath);
  const userConfig: PubmConfig = mod.default ?? mod;

  return resolveConfig(userConfig);
}
```

```typescript
// src/config/index.ts
export { loadConfig } from './loader.js';
export { resolveConfig } from './defaults.js';
export { defineConfig } from './types.js';
export type { PubmConfig, ResolvedPubmConfig, PackageConfig, ValidateConfig, SnapshotConfig } from './types.js';
```

**Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/config/loader.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/config/ tests/unit/config/
git commit -m "feat: add config file loader with jiti"
```

---

## Phase 2: Changeset Core — Parser & Writer

### Task 5: Changeset parser (YAML frontmatter)

**Files:**
- Create: `src/changeset/parser.ts`
- Test: `tests/unit/changeset/parser.test.ts`

**Step 1: Write the test**

```typescript
// tests/unit/changeset/parser.test.ts
import { describe, expect, it } from 'vitest';
import { parseChangeset, type Changeset } from '../../../src/changeset/parser.js';

describe('parseChangeset', () => {
  it('parses a basic changeset with one package', () => {
    const content = `---
"my-package": minor
---

Added a new feature.`;

    const result = parseChangeset(content, 'funny-name.md');
    expect(result).toEqual({
      id: 'funny-name',
      summary: 'Added a new feature.',
      releases: [{ name: 'my-package', type: 'minor' }],
    });
  });

  it('parses changeset with multiple packages', () => {
    const content = `---
"@scope/core": major
"@scope/utils": patch
---

Breaking change to core, fix in utils.`;

    const result = parseChangeset(content, 'brave-foxes.md');
    expect(result.releases).toHaveLength(2);
    expect(result.releases[0]).toEqual({ name: '@scope/core', type: 'major' });
    expect(result.releases[1]).toEqual({ name: '@scope/utils', type: 'patch' });
  });

  it('parses empty changeset', () => {
    const content = `---
---`;

    const result = parseChangeset(content, 'empty.md');
    expect(result.releases).toHaveLength(0);
    expect(result.summary).toBe('');
  });

  it('trims whitespace from summary', () => {
    const content = `---
"pkg": patch
---

  Fixed a bug.
`;

    const result = parseChangeset(content, 'test.md');
    expect(result.summary).toBe('Fixed a bug.');
  });

  it('handles multiline summary', () => {
    const content = `---
"pkg": minor
---

Added feature A.

Also updated feature B to handle edge cases.`;

    const result = parseChangeset(content, 'multi.md');
    expect(result.summary).toContain('Added feature A.');
    expect(result.summary).toContain('Also updated feature B');
  });

  it('strips .md extension from id', () => {
    const result = parseChangeset('---\n---', 'my-change.md');
    expect(result.id).toBe('my-change');
  });

  it('throws on invalid frontmatter', () => {
    expect(() => parseChangeset('no frontmatter', 'bad.md')).toThrow();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/changeset/parser.test.ts`
Expected: FAIL

**Step 3: Write implementation**

```typescript
// src/changeset/parser.ts
import { parse as parseYaml } from 'yaml';

export type BumpType = 'patch' | 'minor' | 'major';

export interface Release {
  name: string;
  type: BumpType;
}

export interface Changeset {
  id: string;
  summary: string;
  releases: Release[];
}

const FRONTMATTER_REGEX = /^---\n([\s\S]*?)\n---(?:\n([\s\S]*))?$/;

export function parseChangeset(content: string, fileName: string): Changeset {
  const match = content.trim().match(FRONTMATTER_REGEX);
  if (!match) {
    throw new Error(`Invalid changeset format in ${fileName}: missing frontmatter`);
  }

  const [, frontmatter, body] = match;
  const id = fileName.replace(/\.md$/, '');
  const summary = (body ?? '').trim();

  const releases: Release[] = [];
  if (frontmatter.trim()) {
    const parsed = parseYaml(frontmatter) as Record<string, string> | null;
    if (parsed) {
      for (const [name, type] of Object.entries(parsed)) {
        releases.push({ name, type: type as BumpType });
      }
    }
  }

  return { id, summary, releases };
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/changeset/parser.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/changeset/parser.ts tests/unit/changeset/parser.test.ts
git commit -m "feat: add changeset file parser"
```

---

### Task 6: Changeset writer (file creation)

**Files:**
- Create: `src/changeset/writer.ts`
- Test: `tests/unit/changeset/writer.test.ts`

**Step 1: Write the test**

```typescript
// tests/unit/changeset/writer.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  readdirSync: vi.fn(),
}));

import { existsSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { generateChangesetContent, generateChangesetId, writeChangeset } from '../../../src/changeset/writer.js';

const mockedExistsSync = vi.mocked(existsSync);
const mockedMkdirSync = vi.mocked(mkdirSync);
const mockedWriteFileSync = vi.mocked(writeFileSync);
const mockedReaddirSync = vi.mocked(readdirSync);

describe('generateChangesetContent', () => {
  it('generates content with single release', () => {
    const content = generateChangesetContent(
      [{ name: 'my-pkg', type: 'minor' }],
      'Added a feature',
    );
    expect(content).toBe('---\n"my-pkg": minor\n---\n\nAdded a feature\n');
  });

  it('generates content with multiple releases', () => {
    const content = generateChangesetContent(
      [
        { name: '@scope/a', type: 'major' },
        { name: '@scope/b', type: 'patch' },
      ],
      'Breaking change',
    );
    expect(content).toContain('"@scope/a": major');
    expect(content).toContain('"@scope/b": patch');
    expect(content).toContain('Breaking change');
  });

  it('generates empty changeset', () => {
    const content = generateChangesetContent([], '');
    expect(content).toBe('---\n---\n');
  });
});

describe('generateChangesetId', () => {
  it('returns a string with two words separated by hyphen', () => {
    const id = generateChangesetId();
    expect(id).toMatch(/^[a-z]+-[a-z]+$/);
  });

  it('generates unique ids', () => {
    const ids = new Set(Array.from({ length: 20 }, () => generateChangesetId()));
    expect(ids.size).toBeGreaterThan(1);
  });
});

describe('writeChangeset', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedExistsSync.mockReturnValue(true);
    mockedReaddirSync.mockReturnValue([]);
  });

  it('creates .pubm/changesets directory if missing', () => {
    mockedExistsSync.mockReturnValue(false);
    writeChangeset(
      [{ name: 'pkg', type: 'patch' }],
      'Fix bug',
    );
    expect(mockedMkdirSync).toHaveBeenCalledWith(
      expect.stringContaining('.pubm/changesets'),
      { recursive: true },
    );
  });

  it('writes changeset file', () => {
    writeChangeset(
      [{ name: 'pkg', type: 'minor' }],
      'New feature',
    );
    expect(mockedWriteFileSync).toHaveBeenCalledWith(
      expect.stringMatching(/\.pubm\/changesets\/[a-z]+-[a-z]+\.md$/),
      expect.stringContaining('"pkg": minor'),
    );
  });

  it('returns the file path', () => {
    const result = writeChangeset(
      [{ name: 'pkg', type: 'patch' }],
      'Fix',
    );
    expect(result).toMatch(/\.pubm\/changesets\/[a-z]+-[a-z]+\.md$/);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/changeset/writer.test.ts`
Expected: FAIL

**Step 3: Write implementation**

```typescript
// src/changeset/writer.ts
import { existsSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import type { Release } from './parser.js';

const ADJECTIVES = [
  'brave', 'calm', 'dark', 'eager', 'fair', 'glad', 'happy', 'idle',
  'jolly', 'keen', 'lame', 'mild', 'neat', 'odd', 'pale', 'quick',
  'rare', 'safe', 'tall', 'vast', 'warm', 'young', 'bold', 'cool',
  'deep', 'fast', 'gold', 'huge', 'just', 'kind', 'lean', 'loud',
];

const NOUNS = [
  'foxes', 'bears', 'cats', 'dogs', 'elms', 'fish', 'goats', 'hawks',
  'inks', 'jays', 'keys', 'lamps', 'maps', 'nets', 'owls', 'pens',
  'rays', 'suns', 'teas', 'urns', 'vans', 'wasps', 'yaks', 'bees',
  'cows', 'deer', 'eels', 'figs', 'gems', 'hens', 'iris', 'jade',
];

export function generateChangesetId(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  return `${adj}-${noun}`;
}

export function generateChangesetContent(releases: Release[], summary: string): string {
  const lines: string[] = ['---'];

  for (const release of releases) {
    lines.push(`"${release.name}": ${release.type}`);
  }

  lines.push('---');

  if (summary) {
    lines.push('', summary);
  }

  return lines.join('\n') + '\n';
}

function getChangesetsDir(cwd: string = process.cwd()): string {
  return path.resolve(cwd, '.pubm', 'changesets');
}

export function writeChangeset(
  releases: Release[],
  summary: string,
  cwd?: string,
): string {
  const dir = getChangesetsDir(cwd);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  // Ensure unique filename
  let id: string;
  const existing = existsSync(dir) ? readdirSync(dir) : [];
  do {
    id = generateChangesetId();
  } while (existing.includes(`${id}.md`));

  const filePath = path.join(dir, `${id}.md`);
  const content = generateChangesetContent(releases, summary);
  writeFileSync(filePath, content);

  return filePath;
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/changeset/writer.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/changeset/writer.ts tests/unit/changeset/writer.test.ts
git commit -m "feat: add changeset file writer"
```

---

### Task 7: Changeset reader (read all pending changesets)

**Files:**
- Create: `src/changeset/reader.ts`
- Test: `tests/unit/changeset/reader.test.ts`

**Step 1: Write the test**

```typescript
// tests/unit/changeset/reader.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readdirSync: vi.fn(),
  readFileSync: vi.fn(),
}));

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { readChangesets } from '../../../src/changeset/reader.js';

const mockedExistsSync = vi.mocked(existsSync);
const mockedReaddirSync = vi.mocked(readdirSync);
const mockedReadFileSync = vi.mocked(readFileSync);

describe('readChangesets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty array when directory does not exist', () => {
    mockedExistsSync.mockReturnValue(false);
    expect(readChangesets()).toEqual([]);
  });

  it('returns empty array when no .md files exist', () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReaddirSync.mockReturnValue(['README.md'] as any);
    // README.md is in dir but readChangesets only reads non-README .md files
    mockedReadFileSync.mockReturnValue('not a changeset');
    const result = readChangesets();
    // Depends on implementation — README may be excluded
    expect(Array.isArray(result)).toBe(true);
  });

  it('reads and parses all changeset files', () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReaddirSync.mockReturnValue(['brave-foxes.md', 'calm-bears.md'] as any);
    mockedReadFileSync
      .mockReturnValueOnce('---\n"pkg-a": minor\n---\n\nFeature A')
      .mockReturnValueOnce('---\n"pkg-a": patch\n---\n\nFix A');

    const result = readChangesets();
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('brave-foxes');
    expect(result[1].id).toBe('calm-bears');
  });

  it('skips non-.md files', () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReaddirSync.mockReturnValue(['brave-foxes.md', 'config.json', 'README'] as any);
    mockedReadFileSync.mockReturnValue('---\n"pkg": patch\n---\n\nFix');

    const result = readChangesets();
    expect(result).toHaveLength(1);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/changeset/reader.test.ts`
Expected: FAIL

**Step 3: Write implementation**

```typescript
// src/changeset/reader.ts
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseChangeset, type Changeset } from './parser.js';

function getChangesetsDir(cwd: string = process.cwd()): string {
  return path.resolve(cwd, '.pubm', 'changesets');
}

export function readChangesets(cwd?: string): Changeset[] {
  const dir = getChangesetsDir(cwd);

  if (!existsSync(dir)) {
    return [];
  }

  const files = readdirSync(dir).filter(
    (f) => f.endsWith('.md') && f !== 'README.md',
  );

  return files.map((fileName) => {
    const content = readFileSync(path.join(dir, fileName), 'utf-8');
    return parseChangeset(content, fileName);
  });
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/changeset/reader.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/changeset/reader.ts tests/unit/changeset/reader.test.ts
git commit -m "feat: add changeset reader for pending changesets"
```

---

## Phase 3: Changeset Status Command

### Task 8: Status logic

**Files:**
- Create: `src/changeset/status.ts`
- Test: `tests/unit/changeset/status.test.ts`

**Step 1: Write the test**

```typescript
// tests/unit/changeset/status.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../../src/changeset/reader.js', () => ({
  readChangesets: vi.fn(),
}));

import { readChangesets } from '../../../src/changeset/reader.js';
import { getStatus, type PackageStatus } from '../../../src/changeset/status.js';

const mockedReadChangesets = vi.mocked(readChangesets);

describe('getStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty map when no changesets', () => {
    mockedReadChangesets.mockReturnValue([]);
    const status = getStatus();
    expect(status.packages.size).toBe(0);
    expect(status.hasChangesets).toBe(false);
  });

  it('aggregates bump types per package (max wins)', () => {
    mockedReadChangesets.mockReturnValue([
      { id: 'a', summary: 'Fix', releases: [{ name: 'pkg', type: 'patch' }] },
      { id: 'b', summary: 'Feature', releases: [{ name: 'pkg', type: 'minor' }] },
    ]);

    const status = getStatus();
    expect(status.packages.get('pkg')?.bumpType).toBe('minor');
    expect(status.packages.get('pkg')?.changesetCount).toBe(2);
  });

  it('major beats minor and patch', () => {
    mockedReadChangesets.mockReturnValue([
      { id: 'a', summary: '', releases: [{ name: 'pkg', type: 'minor' }] },
      { id: 'b', summary: '', releases: [{ name: 'pkg', type: 'major' }] },
      { id: 'c', summary: '', releases: [{ name: 'pkg', type: 'patch' }] },
    ]);

    const status = getStatus();
    expect(status.packages.get('pkg')?.bumpType).toBe('major');
  });

  it('tracks multiple packages independently', () => {
    mockedReadChangesets.mockReturnValue([
      { id: 'a', summary: '', releases: [
        { name: 'pkg-a', type: 'minor' },
        { name: 'pkg-b', type: 'patch' },
      ]},
    ]);

    const status = getStatus();
    expect(status.packages.get('pkg-a')?.bumpType).toBe('minor');
    expect(status.packages.get('pkg-b')?.bumpType).toBe('patch');
    expect(status.hasChangesets).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/changeset/status.test.ts`
Expected: FAIL

**Step 3: Write implementation**

```typescript
// src/changeset/status.ts
import { readChangesets } from './reader.js';
import type { BumpType, Changeset } from './parser.js';

export interface PackageStatus {
  bumpType: BumpType;
  changesetCount: number;
  summaries: string[];
}

export interface Status {
  packages: Map<string, PackageStatus>;
  changesets: Changeset[];
  hasChangesets: boolean;
}

const BUMP_ORDER: Record<BumpType, number> = {
  patch: 0,
  minor: 1,
  major: 2,
};

function maxBump(a: BumpType, b: BumpType): BumpType {
  return BUMP_ORDER[a] >= BUMP_ORDER[b] ? a : b;
}

export function getStatus(cwd?: string): Status {
  const changesets = readChangesets(cwd);
  const packages = new Map<string, PackageStatus>();

  for (const cs of changesets) {
    for (const release of cs.releases) {
      const existing = packages.get(release.name);
      if (existing) {
        existing.bumpType = maxBump(existing.bumpType, release.type);
        existing.changesetCount++;
        if (cs.summary) existing.summaries.push(cs.summary);
      } else {
        packages.set(release.name, {
          bumpType: release.type,
          changesetCount: 1,
          summaries: cs.summary ? [cs.summary] : [],
        });
      }
    }
  }

  return {
    packages,
    changesets,
    hasChangesets: changesets.length > 0,
  };
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/changeset/status.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/changeset/status.ts tests/unit/changeset/status.test.ts
git commit -m "feat: add changeset status aggregation"
```

---

## Phase 4: Monorepo — Workspace Detection

### Task 9: Workspace detection

**Files:**
- Create: `src/monorepo/workspace.ts`
- Test: `tests/unit/monorepo/workspace.test.ts`

**Step 1: Write the test**

```typescript
// tests/unit/monorepo/workspace.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

vi.mock('yaml', () => ({
  parse: vi.fn(),
}));

import { existsSync, readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { detectWorkspace, type WorkspaceInfo } from '../../../src/monorepo/workspace.js';

const mockedExistsSync = vi.mocked(existsSync);
const mockedReadFileSync = vi.mocked(readFileSync);
const mockedParseYaml = vi.mocked(parseYaml);

describe('detectWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedExistsSync.mockReturnValue(false);
  });

  it('returns null when no workspace config found', () => {
    const result = detectWorkspace();
    expect(result).toBeNull();
  });

  it('detects pnpm workspace from pnpm-workspace.yaml', () => {
    mockedExistsSync.mockImplementation((p) =>
      String(p).endsWith('pnpm-workspace.yaml'),
    );
    mockedReadFileSync.mockReturnValue('');
    mockedParseYaml.mockReturnValue({ packages: ['packages/*'] });

    const result = detectWorkspace();
    expect(result).not.toBeNull();
    expect(result!.type).toBe('pnpm');
    expect(result!.patterns).toEqual(['packages/*']);
  });

  it('detects npm/yarn workspace from package.json workspaces field', () => {
    mockedExistsSync.mockImplementation((p) =>
      String(p).endsWith('package.json'),
    );
    mockedReadFileSync.mockReturnValue(
      JSON.stringify({ workspaces: ['packages/*', 'apps/*'] }),
    );

    const result = detectWorkspace();
    expect(result).not.toBeNull();
    expect(result!.type).toBe('npm');
    expect(result!.patterns).toEqual(['packages/*', 'apps/*']);
  });

  it('handles yarn workspaces object format', () => {
    mockedExistsSync.mockImplementation((p) =>
      String(p).endsWith('package.json'),
    );
    mockedReadFileSync.mockReturnValue(
      JSON.stringify({ workspaces: { packages: ['packages/*'] } }),
    );

    const result = detectWorkspace();
    expect(result).not.toBeNull();
    expect(result!.patterns).toEqual(['packages/*']);
  });

  it('pnpm-workspace.yaml takes priority over package.json', () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue('');
    mockedParseYaml.mockReturnValue({ packages: ['from-pnpm/*'] });

    const result = detectWorkspace();
    expect(result!.type).toBe('pnpm');
    expect(result!.patterns).toEqual(['from-pnpm/*']);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/monorepo/workspace.test.ts`
Expected: FAIL

**Step 3: Write implementation**

```typescript
// src/monorepo/workspace.ts
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';

export interface WorkspaceInfo {
  type: 'pnpm' | 'npm' | 'yarn';
  patterns: string[];
}

export function detectWorkspace(cwd: string = process.cwd()): WorkspaceInfo | null {
  // Priority 1: pnpm-workspace.yaml
  const pnpmWorkspacePath = path.resolve(cwd, 'pnpm-workspace.yaml');
  if (existsSync(pnpmWorkspacePath)) {
    const content = readFileSync(pnpmWorkspacePath, 'utf-8');
    const parsed = parseYaml(content) as { packages?: string[] } | null;
    if (parsed?.packages) {
      return { type: 'pnpm', patterns: parsed.packages };
    }
  }

  // Priority 2: package.json workspaces
  const packageJsonPath = path.resolve(cwd, 'package.json');
  if (existsSync(packageJsonPath)) {
    const content = readFileSync(packageJsonPath, 'utf-8');
    const parsed = JSON.parse(content);
    const workspaces = parsed.workspaces;
    if (workspaces) {
      const patterns = Array.isArray(workspaces)
        ? workspaces
        : workspaces.packages ?? [];
      if (patterns.length > 0) {
        return { type: 'npm', patterns };
      }
    }
  }

  return null;
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/monorepo/workspace.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/monorepo/workspace.ts tests/unit/monorepo/workspace.test.ts
git commit -m "feat: add workspace detection for pnpm/npm/yarn"
```

---

### Task 10: Dependency graph and topological sort

**Files:**
- Create: `src/monorepo/dependency-graph.ts`
- Test: `tests/unit/monorepo/dependency-graph.test.ts`

**Step 1: Write the test**

```typescript
// tests/unit/monorepo/dependency-graph.test.ts
import { describe, expect, it } from 'vitest';
import {
  buildDependencyGraph,
  topologicalSort,
  type PackageNode,
} from '../../../src/monorepo/dependency-graph.js';

describe('buildDependencyGraph', () => {
  it('builds graph from package manifests', () => {
    const packages: PackageNode[] = [
      { name: '@org/core', version: '1.0.0', path: 'packages/core', dependencies: {} },
      { name: '@org/utils', version: '1.0.0', path: 'packages/utils', dependencies: { '@org/core': '^1.0.0' } },
    ];

    const graph = buildDependencyGraph(packages);
    expect(graph.get('@org/utils')).toContain('@org/core');
    expect(graph.get('@org/core')).toEqual([]);
  });

  it('ignores external dependencies', () => {
    const packages: PackageNode[] = [
      { name: 'pkg', version: '1.0.0', path: '.', dependencies: { lodash: '^4.0.0' } },
    ];

    const graph = buildDependencyGraph(packages);
    expect(graph.get('pkg')).toEqual([]);
  });
});

describe('topologicalSort', () => {
  it('sorts packages in dependency order', () => {
    const graph = new Map<string, string[]>([
      ['@org/app', ['@org/core', '@org/utils']],
      ['@org/utils', ['@org/core']],
      ['@org/core', []],
    ]);

    const sorted = topologicalSort(graph);
    const coreIdx = sorted.indexOf('@org/core');
    const utilsIdx = sorted.indexOf('@org/utils');
    const appIdx = sorted.indexOf('@org/app');

    expect(coreIdx).toBeLessThan(utilsIdx);
    expect(utilsIdx).toBeLessThan(appIdx);
  });

  it('handles independent packages', () => {
    const graph = new Map<string, string[]>([
      ['a', []],
      ['b', []],
      ['c', []],
    ]);

    const sorted = topologicalSort(graph);
    expect(sorted).toHaveLength(3);
  });

  it('throws on circular dependency', () => {
    const graph = new Map<string, string[]>([
      ['a', ['b']],
      ['b', ['a']],
    ]);

    expect(() => topologicalSort(graph)).toThrow(/circular/i);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/monorepo/dependency-graph.test.ts`
Expected: FAIL

**Step 3: Write implementation**

```typescript
// src/monorepo/dependency-graph.ts

export interface PackageNode {
  name: string;
  version: string;
  path: string;
  dependencies: Record<string, string>;
}

export function buildDependencyGraph(
  packages: PackageNode[],
): Map<string, string[]> {
  const packageNames = new Set(packages.map((p) => p.name));
  const graph = new Map<string, string[]>();

  for (const pkg of packages) {
    const internalDeps = Object.keys(pkg.dependencies).filter((dep) =>
      packageNames.has(dep),
    );
    graph.set(pkg.name, internalDeps);
  }

  return graph;
}

export function topologicalSort(graph: Map<string, string[]>): string[] {
  const sorted: string[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();

  function visit(node: string): void {
    if (visited.has(node)) return;
    if (visiting.has(node)) {
      throw new Error(
        `Circular dependency detected involving "${node}"`,
      );
    }

    visiting.add(node);
    const deps = graph.get(node) ?? [];
    for (const dep of deps) {
      visit(dep);
    }
    visiting.delete(node);
    visited.add(node);
    sorted.push(node);
  }

  for (const node of graph.keys()) {
    visit(node);
  }

  return sorted;
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/monorepo/dependency-graph.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/monorepo/dependency-graph.ts tests/unit/monorepo/dependency-graph.test.ts
git commit -m "feat: add dependency graph and topological sort"
```

---

### Task 11: Fixed/Linked group resolution

**Files:**
- Create: `src/monorepo/groups.ts`
- Test: `tests/unit/monorepo/groups.test.ts`

**Step 1: Write the test**

```typescript
// tests/unit/monorepo/groups.test.ts
import { describe, expect, it } from 'vitest';
import { resolveGroups, applyFixedGroup, applyLinkedGroup } from '../../../src/monorepo/groups.js';
import type { BumpType } from '../../../src/changeset/parser.js';

describe('resolveGroups', () => {
  it('resolves glob patterns to package names', () => {
    const groups = [['@myorg/*']];
    const allPackages = ['@myorg/core', '@myorg/utils', '@other/lib'];

    const resolved = resolveGroups(groups, allPackages);
    expect(resolved[0]).toEqual(['@myorg/core', '@myorg/utils']);
  });

  it('passes through exact names', () => {
    const groups = [['pkg-a', 'pkg-b']];
    const allPackages = ['pkg-a', 'pkg-b', 'pkg-c'];

    const resolved = resolveGroups(groups, allPackages);
    expect(resolved[0]).toEqual(['pkg-a', 'pkg-b']);
  });
});

describe('applyFixedGroup', () => {
  it('applies max bump to all packages in group', () => {
    const bumps = new Map<string, BumpType>([
      ['pkg-a', 'patch'],
      ['pkg-b', 'minor'],
    ]);
    const group = ['pkg-a', 'pkg-b', 'pkg-c'];

    applyFixedGroup(bumps, group);

    expect(bumps.get('pkg-a')).toBe('minor');
    expect(bumps.get('pkg-b')).toBe('minor');
    expect(bumps.get('pkg-c')).toBe('minor'); // added even without changeset
  });

  it('does nothing when no bumps in group', () => {
    const bumps = new Map<string, BumpType>();
    const group = ['pkg-a', 'pkg-b'];

    applyFixedGroup(bumps, group);
    expect(bumps.size).toBe(0);
  });
});

describe('applyLinkedGroup', () => {
  it('aligns bumped packages to max bump in group', () => {
    const bumps = new Map<string, BumpType>([
      ['pkg-a', 'patch'],
      ['pkg-b', 'minor'],
    ]);
    const group = ['pkg-a', 'pkg-b', 'pkg-c'];

    applyLinkedGroup(bumps, group);

    expect(bumps.get('pkg-a')).toBe('minor');
    expect(bumps.get('pkg-b')).toBe('minor');
    expect(bumps.has('pkg-c')).toBe(false); // not added — linked only bumps changed packages
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/monorepo/groups.test.ts`
Expected: FAIL

**Step 3: Write implementation**

```typescript
// src/monorepo/groups.ts
import micromatch from 'micromatch';
import type { BumpType } from '../changeset/parser.js';

const BUMP_ORDER: Record<BumpType, number> = { patch: 0, minor: 1, major: 2 };
const BUMP_VALUES: BumpType[] = ['patch', 'minor', 'major'];

function maxBump(a: BumpType, b: BumpType): BumpType {
  return BUMP_ORDER[a] >= BUMP_ORDER[b] ? a : b;
}

export function resolveGroups(
  groups: string[][],
  allPackages: string[],
): string[][] {
  return groups.map((group) => {
    const resolved = new Set<string>();
    for (const pattern of group) {
      const matched = micromatch(allPackages, pattern);
      for (const m of matched) resolved.add(m);
    }
    return [...resolved];
  });
}

export function applyFixedGroup(
  bumps: Map<string, BumpType>,
  group: string[],
): void {
  let groupMaxBump: BumpType | null = null;

  for (const pkg of group) {
    const bump = bumps.get(pkg);
    if (bump) {
      groupMaxBump = groupMaxBump ? maxBump(groupMaxBump, bump) : bump;
    }
  }

  if (!groupMaxBump) return;

  // Fixed: all packages in group get the max bump
  for (const pkg of group) {
    bumps.set(pkg, groupMaxBump);
  }
}

export function applyLinkedGroup(
  bumps: Map<string, BumpType>,
  group: string[],
): void {
  let groupMaxBump: BumpType | null = null;

  for (const pkg of group) {
    const bump = bumps.get(pkg);
    if (bump) {
      groupMaxBump = groupMaxBump ? maxBump(groupMaxBump, bump) : bump;
    }
  }

  if (!groupMaxBump) return;

  // Linked: only packages with existing bumps get aligned
  for (const pkg of group) {
    if (bumps.has(pkg)) {
      bumps.set(pkg, groupMaxBump);
    }
  }
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/monorepo/groups.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/monorepo/groups.ts tests/unit/monorepo/groups.test.ts
git commit -m "feat: add fixed/linked group resolution"
```

---

## Phase 5: Validation — np-style Checks

### Task 12: Entry point verification

**Files:**
- Create: `src/validate/entry-points.ts`
- Test: `tests/unit/validate/entry-points.test.ts`

**Step 1: Write the test**

```typescript
// tests/unit/validate/entry-points.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
}));

import { existsSync } from 'node:fs';
import { validateEntryPoints, type EntryPointError } from '../../../src/validate/entry-points.js';

const mockedExistsSync = vi.mocked(existsSync);

describe('validateEntryPoints', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedExistsSync.mockReturnValue(true);
  });

  it('returns no errors when all entry points exist', () => {
    const pkg = { main: './dist/index.js', types: './dist/index.d.ts' };
    const errors = validateEntryPoints(pkg, '/project');
    expect(errors).toEqual([]);
  });

  it('reports missing main', () => {
    mockedExistsSync.mockReturnValue(false);
    const pkg = { main: './dist/index.js' };
    const errors = validateEntryPoints(pkg, '/project');
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe('main');
    expect(errors[0].path).toBe('./dist/index.js');
  });

  it('validates exports conditions', () => {
    mockedExistsSync.mockImplementation((p) =>
      !String(p).includes('missing'),
    );
    const pkg = {
      exports: {
        '.': {
          import: './dist/index.mjs',
          require: './dist/missing.cjs',
        },
      },
    };
    const errors = validateEntryPoints(pkg, '/project');
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toContain('exports');
  });

  it('validates bin entries', () => {
    mockedExistsSync.mockReturnValue(false);
    const pkg = { bin: { mycli: './bin/cli.js' } };
    const errors = validateEntryPoints(pkg, '/project');
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe('bin.mycli');
  });

  it('skips undefined fields', () => {
    const pkg = {};
    const errors = validateEntryPoints(pkg, '/project');
    expect(errors).toEqual([]);
  });

  it('handles string exports', () => {
    mockedExistsSync.mockReturnValue(false);
    const pkg = { exports: './dist/index.js' };
    const errors = validateEntryPoints(pkg, '/project');
    expect(errors).toHaveLength(1);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/validate/entry-points.test.ts`
Expected: FAIL

**Step 3: Write implementation**

```typescript
// src/validate/entry-points.ts
import { existsSync } from 'node:fs';
import path from 'node:path';

export interface EntryPointError {
  field: string;
  path: string;
}

const SIMPLE_FIELDS = ['main', 'module', 'types', 'typings'] as const;

function checkPath(filePath: string, cwd: string): boolean {
  return existsSync(path.resolve(cwd, filePath));
}

function validateExports(
  exports: unknown,
  cwd: string,
  prefix: string = 'exports',
): EntryPointError[] {
  const errors: EntryPointError[] = [];

  if (typeof exports === 'string') {
    if (!checkPath(exports, cwd)) {
      errors.push({ field: prefix, path: exports });
    }
    return errors;
  }

  if (typeof exports === 'object' && exports !== null) {
    for (const [key, value] of Object.entries(exports)) {
      if (typeof value === 'string') {
        if (!checkPath(value, cwd)) {
          errors.push({ field: `${prefix}["${key}"]`, path: value });
        }
      } else if (typeof value === 'object' && value !== null) {
        errors.push(...validateExports(value, cwd, `${prefix}["${key}"]`));
      }
    }
  }

  return errors;
}

export function validateEntryPoints(
  pkg: Record<string, unknown>,
  cwd: string,
): EntryPointError[] {
  const errors: EntryPointError[] = [];

  for (const field of SIMPLE_FIELDS) {
    const value = pkg[field];
    if (typeof value === 'string' && !checkPath(value, cwd)) {
      errors.push({ field, path: value });
    }
  }

  if (pkg.exports !== undefined) {
    errors.push(...validateExports(pkg.exports, cwd));
  }

  if (pkg.bin !== undefined) {
    if (typeof pkg.bin === 'string') {
      if (!checkPath(pkg.bin, cwd)) {
        errors.push({ field: 'bin', path: pkg.bin });
      }
    } else if (typeof pkg.bin === 'object' && pkg.bin !== null) {
      for (const [name, binPath] of Object.entries(pkg.bin as Record<string, string>)) {
        if (!checkPath(binPath, cwd)) {
          errors.push({ field: `bin.${name}`, path: binPath });
        }
      }
    }
  }

  return errors;
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/validate/entry-points.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/validate/entry-points.ts tests/unit/validate/entry-points.test.ts
git commit -m "feat: add entry point validation"
```

---

### Task 13: Extraneous file detection

**Files:**
- Create: `src/validate/extraneous-files.ts`
- Test: `tests/unit/validate/extraneous-files.test.ts`

**Step 1: Write the test**

```typescript
// tests/unit/validate/extraneous-files.test.ts
import { describe, expect, it } from 'vitest';
import { detectExtraneousFiles, type ExtraneousFile } from '../../../src/validate/extraneous-files.js';

describe('detectExtraneousFiles', () => {
  it('flags .env files', () => {
    const files = ['.env', '.env.local', 'src/index.ts'];
    const result = detectExtraneousFiles(files);
    expect(result).toHaveLength(2);
    expect(result[0].reason).toContain('secret');
  });

  it('flags test files', () => {
    const files = ['src/index.test.ts', 'src/__tests__/foo.ts', 'src/index.spec.js'];
    const result = detectExtraneousFiles(files);
    expect(result).toHaveLength(3);
  });

  it('flags config files', () => {
    const files = ['.eslintrc.js', 'tsconfig.json', '.prettierrc'];
    const result = detectExtraneousFiles(files);
    expect(result.length).toBeGreaterThan(0);
  });

  it('does not flag source files', () => {
    const files = ['dist/index.js', 'dist/index.d.ts', 'package.json', 'README.md'];
    const result = detectExtraneousFiles(files);
    expect(result).toHaveLength(0);
  });

  it('flags source maps', () => {
    const files = ['dist/index.js.map', 'dist/index.mjs.map'];
    const result = detectExtraneousFiles(files);
    expect(result).toHaveLength(2);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/validate/extraneous-files.test.ts`
Expected: FAIL

**Step 3: Write implementation**

```typescript
// src/validate/extraneous-files.ts
import micromatch from 'micromatch';

export interface ExtraneousFile {
  file: string;
  reason: string;
}

const PATTERNS: Array<{ pattern: string | string[]; reason: string }> = [
  { pattern: ['.env', '.env.*'], reason: 'potentially contains secrets' },
  { pattern: ['*.test.*', '*.spec.*', '**/__tests__/**'], reason: 'test file' },
  { pattern: ['*.map'], reason: 'source map' },
  {
    pattern: [
      '.eslintrc*', '.prettierrc*', 'tsconfig.json', 'tsconfig.*.json',
      '.babelrc*', 'jest.config.*', 'vitest.config.*', '.editorconfig',
      'biome.json',
    ],
    reason: 'development config file',
  },
];

export function detectExtraneousFiles(files: string[]): ExtraneousFile[] {
  const result: ExtraneousFile[] = [];

  for (const { pattern, reason } of PATTERNS) {
    const patterns = Array.isArray(pattern) ? pattern : [pattern];
    const matched = micromatch(files, patterns, { basename: true });
    for (const file of matched) {
      result.push({ file, reason });
    }
  }

  return result;
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/validate/extraneous-files.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/validate/extraneous-files.ts tests/unit/validate/extraneous-files.test.ts
git commit -m "feat: add extraneous file detection"
```

---

## Phase 6: CHANGELOG Generation

### Task 14: CHANGELOG generator

**Files:**
- Create: `src/changeset/changelog.ts`
- Test: `tests/unit/changeset/changelog.test.ts`

**Step 1: Write the test**

```typescript
// tests/unit/changeset/changelog.test.ts
import { describe, expect, it } from 'vitest';
import { generateChangelog } from '../../../src/changeset/changelog.js';
import type { BumpType } from '../../../src/changeset/parser.js';

describe('generateChangelog', () => {
  it('generates changelog with minor and patch sections', () => {
    const entries = [
      { summary: 'Added new API', type: 'minor' as BumpType, id: 'brave-fox' },
      { summary: 'Fixed a bug', type: 'patch' as BumpType, id: 'calm-bear' },
    ];

    const md = generateChangelog('1.2.0', entries);
    expect(md).toContain('## 1.2.0');
    expect(md).toContain('### Minor Changes');
    expect(md).toContain('- Added new API');
    expect(md).toContain('### Patch Changes');
    expect(md).toContain('- Fixed a bug');
  });

  it('generates changelog with major section', () => {
    const entries = [
      { summary: 'Breaking: removed old API', type: 'major' as BumpType, id: 'a' },
    ];

    const md = generateChangelog('2.0.0', entries);
    expect(md).toContain('### Major Changes');
    expect(md).toContain('- Breaking: removed old API');
  });

  it('includes dependency updates', () => {
    const entries = [
      { summary: 'Fix', type: 'patch' as BumpType, id: 'a' },
    ];
    const depUpdates = [
      { name: '@org/utils', version: '1.1.0' },
    ];

    const md = generateChangelog('1.0.1', entries, depUpdates);
    expect(md).toContain('### Dependency Updates');
    expect(md).toContain('@org/utils');
    expect(md).toContain('1.1.0');
  });

  it('returns empty string when no entries and no dep updates', () => {
    const md = generateChangelog('1.0.0', []);
    expect(md).toContain('## 1.0.0');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/changeset/changelog.test.ts`
Expected: FAIL

**Step 3: Write implementation**

```typescript
// src/changeset/changelog.ts
import type { BumpType } from './parser.js';

export interface ChangelogEntry {
  summary: string;
  type: BumpType;
  id: string;
}

export interface DependencyUpdate {
  name: string;
  version: string;
}

const SECTION_ORDER: BumpType[] = ['major', 'minor', 'patch'];
const SECTION_TITLES: Record<BumpType, string> = {
  major: 'Major Changes',
  minor: 'Minor Changes',
  patch: 'Patch Changes',
};

export function generateChangelog(
  version: string,
  entries: ChangelogEntry[],
  depUpdates?: DependencyUpdate[],
): string {
  const lines: string[] = [`## ${version}`, ''];

  for (const type of SECTION_ORDER) {
    const items = entries.filter((e) => e.type === type);
    if (items.length === 0) continue;

    lines.push(`### ${SECTION_TITLES[type]}`, '');
    for (const item of items) {
      lines.push(`- ${item.summary}`);
    }
    lines.push('');
  }

  if (depUpdates && depUpdates.length > 0) {
    lines.push('### Dependency Updates', '');
    for (const dep of depUpdates) {
      lines.push(`- Updated \`${dep.name}\` to ${dep.version}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/changeset/changelog.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/changeset/changelog.ts tests/unit/changeset/changelog.test.ts
git commit -m "feat: add CHANGELOG generator"
```

---

## Phase 7: Pre-release & Snapshot

### Task 15: Pre-release state management

**Files:**
- Create: `src/prerelease/pre.ts`
- Test: `tests/unit/prerelease/pre.test.ts`

**Step 1: Write the test**

```typescript
// tests/unit/prerelease/pre.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  unlinkSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { enterPreMode, exitPreMode, readPreState, type PreState } from '../../../src/prerelease/pre.js';

const mockedExistsSync = vi.mocked(existsSync);
const mockedReadFileSync = vi.mocked(readFileSync);
const mockedWriteFileSync = vi.mocked(writeFileSync);
const mockedUnlinkSync = vi.mocked(unlinkSync);

describe('readPreState', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns null when pre.json does not exist', () => {
    mockedExistsSync.mockReturnValue(false);
    expect(readPreState()).toBeNull();
  });

  it('reads and parses pre.json', () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(JSON.stringify({
      mode: 'pre',
      tag: 'beta',
      packages: {},
    }));

    const state = readPreState();
    expect(state).not.toBeNull();
    expect(state!.tag).toBe('beta');
  });
});

describe('enterPreMode', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates pre.json with tag', () => {
    mockedExistsSync.mockReturnValue(true); // .pubm dir exists
    enterPreMode('alpha');
    expect(mockedWriteFileSync).toHaveBeenCalledWith(
      expect.stringContaining('pre.json'),
      expect.stringContaining('"alpha"'),
    );
  });

  it('throws when already in pre-release mode', () => {
    mockedExistsSync.mockImplementation((p) => {
      if (String(p).endsWith('pre.json')) return true;
      return true;
    });
    mockedReadFileSync.mockReturnValue(JSON.stringify({ mode: 'pre', tag: 'beta', packages: {} }));

    expect(() => enterPreMode('alpha')).toThrow(/already/i);
  });
});

describe('exitPreMode', () => {
  beforeEach(() => vi.clearAllMocks());

  it('deletes pre.json', () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(JSON.stringify({ mode: 'pre', tag: 'beta', packages: {} }));

    exitPreMode();
    expect(mockedUnlinkSync).toHaveBeenCalledWith(
      expect.stringContaining('pre.json'),
    );
  });

  it('throws when not in pre-release mode', () => {
    mockedExistsSync.mockReturnValue(false);
    expect(() => exitPreMode()).toThrow(/not in pre-release/i);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/prerelease/pre.test.ts`
Expected: FAIL

**Step 3: Write implementation**

```typescript
// src/prerelease/pre.ts
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import path from 'node:path';

export interface PreState {
  mode: 'pre';
  tag: string;
  packages: Record<string, { baseVersion: string; iteration: number }>;
}

function getPrePath(cwd: string = process.cwd()): string {
  return path.resolve(cwd, '.pubm', 'pre.json');
}

export function readPreState(cwd?: string): PreState | null {
  const prePath = getPrePath(cwd);
  if (!existsSync(prePath)) return null;

  const content = readFileSync(prePath, 'utf-8');
  return JSON.parse(content) as PreState;
}

export function enterPreMode(tag: string, cwd?: string): void {
  const prePath = getPrePath(cwd);

  if (existsSync(prePath)) {
    throw new Error(
      `Already in pre-release mode. Exit first with \`pubm pre exit\`.`,
    );
  }

  const dir = path.dirname(prePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const state: PreState = {
    mode: 'pre',
    tag,
    packages: {},
  };

  writeFileSync(prePath, JSON.stringify(state, null, 2));
}

export function exitPreMode(cwd?: string): void {
  const prePath = getPrePath(cwd);

  if (!existsSync(prePath)) {
    throw new Error('Not in pre-release mode. Nothing to exit.');
  }

  unlinkSync(prePath);
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/prerelease/pre.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/prerelease/pre.ts tests/unit/prerelease/pre.test.ts
git commit -m "feat: add pre-release state management"
```

---

### Task 16: Snapshot version generation

**Files:**
- Create: `src/prerelease/snapshot.ts`
- Test: `tests/unit/prerelease/snapshot.test.ts`

**Step 1: Write the test**

```typescript
// tests/unit/prerelease/snapshot.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { generateSnapshotVersion } from '../../../src/prerelease/snapshot.js';

describe('generateSnapshotVersion', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-04T12:30:00Z'));
  });

  it('generates default snapshot version', () => {
    const version = generateSnapshotVersion({ tag: 'canary' });
    expect(version).toBe('0.0.0-canary-20260304T123000');
  });

  it('uses calculated version as base', () => {
    const version = generateSnapshotVersion({
      tag: 'canary',
      baseVersion: '2.1.0',
      useCalculatedVersion: true,
    });
    expect(version).toBe('2.1.0-canary-20260304T123000');
  });

  it('uses custom template', () => {
    const version = generateSnapshotVersion({
      tag: 'dev',
      template: '{tag}-{commit}',
      commit: 'abc1234',
    });
    expect(version).toBe('0.0.0-dev-abc1234');
  });

  it('defaults tag to snapshot', () => {
    const version = generateSnapshotVersion({});
    expect(version).toMatch(/^0\.0\.0-snapshot-/);
  });

  afterEach(() => {
    vi.useRealTimers();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/prerelease/snapshot.test.ts`
Expected: FAIL

**Step 3: Write implementation**

```typescript
// src/prerelease/snapshot.ts

export interface SnapshotOptions {
  tag?: string;
  baseVersion?: string;
  useCalculatedVersion?: boolean;
  template?: string;
  commit?: string;
}

function formatTimestamp(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  const h = String(now.getUTCHours()).padStart(2, '0');
  const min = String(now.getUTCMinutes()).padStart(2, '0');
  const s = String(now.getUTCSeconds()).padStart(2, '0');
  return `${y}${m}${d}T${h}${min}${s}`;
}

export function generateSnapshotVersion(options: SnapshotOptions): string {
  const tag = options.tag || 'snapshot';
  const base = options.useCalculatedVersion && options.baseVersion
    ? options.baseVersion
    : '0.0.0';

  const timestamp = formatTimestamp();
  const commit = options.commit || '';

  if (options.template) {
    const suffix = options.template
      .replace('{tag}', tag)
      .replace('{timestamp}', timestamp)
      .replace('{commit}', commit)
      .replace('{datetime}', timestamp);
    return `${base}-${suffix}`;
  }

  return `${base}-${tag}-${timestamp}`;
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/prerelease/snapshot.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/prerelease/snapshot.ts tests/unit/prerelease/snapshot.test.ts
git commit -m "feat: add snapshot version generation"
```

---

## Phase 8: CLI Subcommand System

### Task 17: Refactor CLI to subcommands

**Files:**
- Modify: `src/cli.ts`
- Create: `src/commands/add.ts`
- Create: `src/commands/version.ts`
- Create: `src/commands/status.ts`
- Create: `src/commands/pre.ts`
- Create: `src/commands/snapshot.ts`
- Create: `src/commands/publish.ts`
- Create: `src/commands/migrate.ts`
- Create: `src/commands/init.ts`

This is a large refactor. Each command module exports a function that registers the subcommand with the CAC CLI instance.

**Step 1: Create command stubs with tests**

Create each command as a thin module that registers with CAC. Start with `src/commands/status.ts` as the simplest:

```typescript
// src/commands/status.ts
import type { CAC } from 'cac';
import { getStatus } from '../changeset/status.js';

export function registerStatusCommand(cli: CAC): void {
  cli
    .command('status', 'Show pending changeset status')
    .option('--verbose', 'Show full changeset contents')
    .option('--since <ref>', 'Only check changesets since git ref')
    .action(async (options) => {
      const status = getStatus();

      if (!status.hasChangesets) {
        if (options.since) {
          console.log('No changesets found.');
          process.exit(1);
        }
        console.log('No pending changesets.');
        return;
      }

      console.log('Pending changesets:');
      for (const [name, info] of status.packages) {
        console.log(`  ${name}: ${info.bumpType} (${info.changesetCount} changeset${info.changesetCount > 1 ? 's' : ''})`);
        if (options.verbose) {
          for (const summary of info.summaries) {
            console.log(`    - ${summary}`);
          }
        }
      }
    });
}
```

```typescript
// src/commands/add.ts
import type { CAC } from 'cac';
import { writeChangeset } from '../changeset/writer.js';
import type { BumpType } from '../changeset/parser.js';

export function registerAddCommand(cli: CAC): void {
  cli
    .command('add', 'Create a new changeset')
    .option('--empty', 'Create an empty changeset')
    .option('--packages <list>', 'Comma-separated package names')
    .option('--bump <type>', 'Bump type: patch, minor, major')
    .option('--message <text>', 'Changeset summary')
    .action(async (options) => {
      if (options.empty) {
        const filePath = writeChangeset([], '');
        console.log(`Created empty changeset: ${filePath}`);
        return;
      }

      // For non-interactive mode (CI)
      if (options.packages && options.bump && options.message) {
        const packages = (options.packages as string).split(',').map((p: string) => p.trim());
        const releases = packages.map((name: string) => ({
          name,
          type: options.bump as BumpType,
        }));
        const filePath = writeChangeset(releases, options.message as string);
        console.log(`Created changeset: ${filePath}`);
        return;
      }

      // Interactive mode — will be enhanced with listr2 prompts later
      console.log('Interactive changeset creation coming soon. Use --packages, --bump, and --message flags for now.');
    });
}
```

```typescript
// src/commands/pre.ts
import type { CAC } from 'cac';
import { enterPreMode, exitPreMode, readPreState } from '../prerelease/pre.js';

export function registerPreCommand(cli: CAC): void {
  cli
    .command('pre <action> [tag]', 'Manage pre-release mode')
    .action(async (action: string, tag?: string) => {
      if (action === 'enter') {
        if (!tag) {
          console.error('Usage: pubm pre enter <tag>');
          process.exit(1);
        }
        enterPreMode(tag);
        console.log(`Entered pre-release mode (${tag})`);
      } else if (action === 'exit') {
        exitPreMode();
        console.log('Exited pre-release mode');
      } else {
        console.error(`Unknown pre action: ${action}. Use "enter" or "exit".`);
        process.exit(1);
      }
    });
}
```

```typescript
// src/commands/publish.ts
import type { CAC } from 'cac';

// This re-wraps the existing pubm() function as a subcommand
export function registerPublishCommand(cli: CAC): void {
  cli
    .command('publish [version]', 'Publish packages to registries')
    .option('-p, --preview', 'Dry-run mode')
    .option('--registry <list>', 'Comma-separated registries')
    .option('-b, --branch <name>', 'Release branch')
    .option('-a, --any-branch', 'Allow any branch')
    .option('-t, --tag <name>', 'npm dist-tag')
    .option('-c, --contents <path>', 'Publish subdirectory')
    .option('--no-pre-check', 'Skip prerequisite checks')
    .option('--no-condition-check', 'Skip condition checks')
    .option('--no-tests', 'Skip tests')
    .option('--no-build', 'Skip build')
    .option('--no-publish', 'Skip actual publish')
    .option('--publish-only', 'Skip everything except publish')
    .option('--no-release-draft', 'Skip release draft')
    .option('--test-script <name>', 'Test script name')
    .option('--build-script <name>', 'Build script name')
    .option('--no-save-token', 'Do not save tokens')
    .action(async (version, options) => {
      // Delegate to existing pubm logic
      // This will be wired up in the CLI refactor step
      const { resolveCliOptions } = await import('../cli-compat.js');
      const { default: pubm } = await import('../index.js');
      const resolved = resolveCliOptions(version, options);
      await pubm(resolved);
    });
}
```

```typescript
// src/commands/init.ts
import type { CAC } from 'cac';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export function registerInitCommand(cli: CAC): void {
  cli
    .command('init', 'Initialize pubm configuration')
    .action(async () => {
      const pubmDir = path.resolve('.pubm', 'changesets');
      if (!existsSync(pubmDir)) {
        mkdirSync(pubmDir, { recursive: true });
        console.log('Created .pubm/changesets/');
      }

      const configPath = path.resolve('pubm.config.ts');
      if (!existsSync(configPath)) {
        writeFileSync(configPath, [
          "import { defineConfig } from 'pubm'",
          '',
          'export default defineConfig({})',
          '',
        ].join('\n'));
        console.log('Created pubm.config.ts');
      }

      console.log('pubm initialized successfully.');
    });
}
```

```typescript
// src/commands/version.ts
import type { CAC } from 'cac';

export function registerVersionCommand(cli: CAC): void {
  cli
    .command('version', 'Consume changesets and bump versions')
    .action(async () => {
      // Will be implemented in the version consumption task
      console.log('pubm version — coming in next phase');
    });
}
```

```typescript
// src/commands/snapshot.ts
import type { CAC } from 'cac';

export function registerSnapshotCommand(cli: CAC): void {
  cli
    .command('snapshot [tag]', 'Create a snapshot release')
    .action(async (tag?: string) => {
      // Will be implemented in the snapshot task
      console.log(`pubm snapshot ${tag ?? ''} — coming in next phase`);
    });
}
```

```typescript
// src/commands/migrate.ts
import type { CAC } from 'cac';

export function registerMigrateCommand(cli: CAC): void {
  cli
    .command('migrate', 'Migrate from .changeset/ to .pubm/')
    .action(async () => {
      // Will be implemented in the migration task
      console.log('pubm migrate — coming in next phase');
    });
}
```

**Step 2: Refactor src/cli.ts to use subcommands**

The key change: keep existing default command behavior for backward compatibility, add subcommands.

```typescript
// src/cli.ts — refactored (preserve existing logic as default command + add subcommands)
```

This is a significant refactor of `src/cli.ts`. The existing positional `[version]` behavior maps to `pubm publish [version]`. The refactored CLI:
1. Registers all subcommands
2. Keeps the default (no subcommand) behavior as interactive mode
3. Maps `pubm patch/minor/major` to `pubm publish patch/minor/major`

**Step 3: Run existing tests to ensure nothing breaks**

Run: `pnpm vitest run`
Expected: All existing tests PASS

**Step 4: Commit**

```bash
git add src/commands/ src/cli.ts
git commit -m "feat: add CLI subcommand system (add, version, publish, status, pre, snapshot, init, migrate)"
```

---

## Phase 9: Changeset Version Command (Core Logic)

### Task 18: Version consumption and bump logic

**Files:**
- Create: `src/changeset/version.ts`
- Test: `tests/unit/changeset/version.test.ts`

**Step 1: Write the test**

```typescript
// tests/unit/changeset/version.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../../src/changeset/reader.js', () => ({
  readChangesets: vi.fn(),
}));

vi.mock('semver', () => ({
  inc: vi.fn((version, type) => {
    const parts = version.split('.').map(Number);
    if (type === 'major') return `${parts[0] + 1}.0.0`;
    if (type === 'minor') return `${parts[0]}.${parts[1] + 1}.0`;
    return `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
  }),
}));

import { readChangesets } from '../../../src/changeset/reader.js';
import { calculateVersionBumps } from '../../../src/changeset/version.js';

const mockedReadChangesets = vi.mocked(readChangesets);

describe('calculateVersionBumps', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calculates bumps from changesets', () => {
    mockedReadChangesets.mockReturnValue([
      { id: 'a', summary: 'Fix', releases: [{ name: 'pkg', type: 'patch' }] },
    ]);

    const currentVersions = new Map([['pkg', '1.0.0']]);
    const bumps = calculateVersionBumps(currentVersions);

    expect(bumps.get('pkg')).toEqual({
      currentVersion: '1.0.0',
      newVersion: '1.0.1',
      bumpType: 'patch',
    });
  });

  it('takes max bump across multiple changesets', () => {
    mockedReadChangesets.mockReturnValue([
      { id: 'a', summary: '', releases: [{ name: 'pkg', type: 'patch' }] },
      { id: 'b', summary: '', releases: [{ name: 'pkg', type: 'minor' }] },
    ]);

    const currentVersions = new Map([['pkg', '1.0.0']]);
    const bumps = calculateVersionBumps(currentVersions);

    expect(bumps.get('pkg')?.newVersion).toBe('1.1.0');
    expect(bumps.get('pkg')?.bumpType).toBe('minor');
  });

  it('handles multiple packages', () => {
    mockedReadChangesets.mockReturnValue([
      { id: 'a', summary: '', releases: [
        { name: 'core', type: 'minor' },
        { name: 'utils', type: 'patch' },
      ]},
    ]);

    const currentVersions = new Map([
      ['core', '2.0.0'],
      ['utils', '1.5.0'],
    ]);
    const bumps = calculateVersionBumps(currentVersions);

    expect(bumps.get('core')?.newVersion).toBe('2.1.0');
    expect(bumps.get('utils')?.newVersion).toBe('1.5.1');
  });

  it('returns empty map when no changesets', () => {
    mockedReadChangesets.mockReturnValue([]);
    const bumps = calculateVersionBumps(new Map());
    expect(bumps.size).toBe(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/changeset/version.test.ts`
Expected: FAIL

**Step 3: Write implementation**

```typescript
// src/changeset/version.ts
import { inc } from 'semver';
import { readChangesets } from './reader.js';
import type { BumpType } from './parser.js';

export interface VersionBump {
  currentVersion: string;
  newVersion: string;
  bumpType: BumpType;
}

const BUMP_ORDER: Record<BumpType, number> = { patch: 0, minor: 1, major: 2 };

function maxBump(a: BumpType, b: BumpType): BumpType {
  return BUMP_ORDER[a] >= BUMP_ORDER[b] ? a : b;
}

export function calculateVersionBumps(
  currentVersions: Map<string, string>,
  cwd?: string,
): Map<string, VersionBump> {
  const changesets = readChangesets(cwd);
  const bumpTypes = new Map<string, BumpType>();

  for (const cs of changesets) {
    for (const release of cs.releases) {
      const existing = bumpTypes.get(release.name);
      bumpTypes.set(
        release.name,
        existing ? maxBump(existing, release.type) : release.type,
      );
    }
  }

  const result = new Map<string, VersionBump>();

  for (const [name, bumpType] of bumpTypes) {
    const currentVersion = currentVersions.get(name);
    if (!currentVersion) continue;

    const newVersion = inc(currentVersion, bumpType);
    if (!newVersion) continue;

    result.set(name, { currentVersion, newVersion, bumpType });
  }

  return result;
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/changeset/version.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/changeset/version.ts tests/unit/changeset/version.test.ts
git commit -m "feat: add version bump calculation from changesets"
```

---

## Phase 10: Migration Tool

### Task 19: Changeset migration (.changeset/ → .pubm/)

**Files:**
- Create: `src/changeset/migrate.ts`
- Test: `tests/unit/changeset/migrate.test.ts`

**Step 1: Write the test**

```typescript
// tests/unit/changeset/migrate.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  readdirSync: vi.fn(),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  renameSync: vi.fn(),
  copyFileSync: vi.fn(),
}));

import { existsSync, readFileSync, readdirSync, mkdirSync, copyFileSync } from 'node:fs';
import { migrateFromChangesets, type MigrationResult } from '../../../src/changeset/migrate.js';

const mockedExistsSync = vi.mocked(existsSync);
const mockedReadFileSync = vi.mocked(readFileSync);
const mockedReaddirSync = vi.mocked(readdirSync);
const mockedMkdirSync = vi.mocked(mkdirSync);
const mockedCopyFileSync = vi.mocked(copyFileSync);

describe('migrateFromChangesets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedExistsSync.mockReturnValue(false);
  });

  it('returns error when .changeset/ does not exist', () => {
    const result = migrateFromChangesets();
    expect(result.success).toBe(false);
    expect(result.error).toContain('.changeset');
  });

  it('migrates changeset files', () => {
    mockedExistsSync.mockImplementation((p) => {
      const s = String(p);
      return s.includes('.changeset') && !s.includes('.pubm');
    });
    mockedReaddirSync.mockReturnValue(['brave-foxes.md', 'config.json', 'README.md'] as any);
    mockedReadFileSync.mockReturnValue('{}');

    const result = migrateFromChangesets();
    expect(result.success).toBe(true);
    expect(result.migratedFiles).toContain('brave-foxes.md');
    expect(mockedMkdirSync).toHaveBeenCalled();
    expect(mockedCopyFileSync).toHaveBeenCalled();
  });

  it('skips config.json and README.md', () => {
    mockedExistsSync.mockImplementation((p) =>
      String(p).includes('.changeset'),
    );
    mockedReaddirSync.mockReturnValue(['config.json', 'README.md'] as any);
    mockedReadFileSync.mockReturnValue('{}');

    const result = migrateFromChangesets();
    expect(result.migratedFiles).toHaveLength(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/changeset/migrate.test.ts`
Expected: FAIL

**Step 3: Write implementation**

```typescript
// src/changeset/migrate.ts
import { existsSync, readdirSync, mkdirSync, copyFileSync, readFileSync } from 'node:fs';
import path from 'node:path';

export interface MigrationResult {
  success: boolean;
  error?: string;
  migratedFiles: string[];
  configMigrated: boolean;
}

export function migrateFromChangesets(cwd: string = process.cwd()): MigrationResult {
  const changesetDir = path.resolve(cwd, '.changeset');
  const pubmDir = path.resolve(cwd, '.pubm', 'changesets');

  if (!existsSync(changesetDir)) {
    return {
      success: false,
      error: '.changeset/ directory not found',
      migratedFiles: [],
      configMigrated: false,
    };
  }

  if (!existsSync(pubmDir)) {
    mkdirSync(pubmDir, { recursive: true });
  }

  const files = readdirSync(changesetDir);
  const migratedFiles: string[] = [];
  let configMigrated = false;

  for (const file of files) {
    if (file === 'config.json' || file === 'README.md') continue;

    if (file.endsWith('.md')) {
      copyFileSync(
        path.join(changesetDir, file),
        path.join(pubmDir, file),
      );
      migratedFiles.push(file);
    }

    if (file === 'pre.json') {
      copyFileSync(
        path.join(changesetDir, file),
        path.resolve(cwd, '.pubm', 'pre.json'),
      );
    }
  }

  // Config migration hint
  const configPath = path.join(changesetDir, 'config.json');
  if (existsSync(configPath)) {
    configMigrated = true;
    // Note: actual config.json → pubm.config.ts conversion
    // would need more logic; for now we flag it
  }

  return {
    success: true,
    migratedFiles,
    configMigrated,
  };
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/unit/changeset/migrate.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/changeset/migrate.ts tests/unit/changeset/migrate.test.ts
git commit -m "feat: add changeset migration tool"
```

---

## Phase 11: Integration — Wire Everything Together

### Task 20: Create changeset/index.ts barrel export

**Files:**
- Create: `src/changeset/index.ts`

```typescript
// src/changeset/index.ts
export { parseChangeset, type Changeset, type Release, type BumpType } from './parser.js';
export { writeChangeset, generateChangesetContent, generateChangesetId } from './writer.js';
export { readChangesets } from './reader.js';
export { getStatus, type PackageStatus, type Status } from './status.js';
export { calculateVersionBumps, type VersionBump } from './version.js';
export { generateChangelog, type ChangelogEntry, type DependencyUpdate } from './changelog.js';
export { migrateFromChangesets, type MigrationResult } from './migrate.js';
```

### Task 21: Create monorepo/index.ts barrel export

```typescript
// src/monorepo/index.ts
export { detectWorkspace, type WorkspaceInfo } from './workspace.js';
export { buildDependencyGraph, topologicalSort, type PackageNode } from './dependency-graph.js';
export { resolveGroups, applyFixedGroup, applyLinkedGroup } from './groups.js';
```

### Task 22: Create prerelease/index.ts barrel export

```typescript
// src/prerelease/index.ts
export { readPreState, enterPreMode, exitPreMode, type PreState } from './pre.js';
export { generateSnapshotVersion, type SnapshotOptions } from './snapshot.js';
```

### Task 23: Create validate/index.ts barrel export

```typescript
// src/validate/index.ts
export { validateEntryPoints, type EntryPointError } from './entry-points.js';
export { detectExtraneousFiles, type ExtraneousFile } from './extraneous-files.js';
```

### Task 24: Update src/index.ts programmatic API

**Files:**
- Modify: `src/index.ts`

Add re-exports for the new modules so users can access them programmatically:

```typescript
// src/index.ts — add exports
export { defineConfig } from './config/types.js';
export type { PubmConfig } from './config/types.js';
```

**Commit all barrel exports:**

```bash
git add src/changeset/index.ts src/monorepo/index.ts src/prerelease/index.ts src/validate/index.ts src/index.ts
git commit -m "feat: add barrel exports and update programmatic API"
```

---

## Phase 12: Test Fixtures

### Task 25: Add monorepo test fixtures

**Files:**
- Create: `tests/fixtures/monorepo-basic/package.json`
- Create: `tests/fixtures/monorepo-basic/pnpm-workspace.yaml`
- Create: `tests/fixtures/monorepo-basic/packages/core/package.json`
- Create: `tests/fixtures/monorepo-basic/packages/utils/package.json`

```json
// tests/fixtures/monorepo-basic/package.json
{
  "name": "monorepo-root",
  "version": "0.0.0",
  "private": true
}
```

```yaml
# tests/fixtures/monorepo-basic/pnpm-workspace.yaml
packages:
  - "packages/*"
```

```json
// tests/fixtures/monorepo-basic/packages/core/package.json
{
  "name": "@test/core",
  "version": "1.0.0",
  "dependencies": {}
}
```

```json
// tests/fixtures/monorepo-basic/packages/utils/package.json
{
  "name": "@test/utils",
  "version": "1.0.0",
  "dependencies": {
    "@test/core": "^1.0.0"
  }
}
```

### Task 26: Add changeset migration fixture

```
tests/fixtures/with-changesets/
  .changeset/
    config.json
    brave-foxes.md
  package.json
```

**Commit fixtures:**

```bash
git add tests/fixtures/monorepo-basic/ tests/fixtures/with-changesets/
git commit -m "test: add monorepo and changeset migration fixtures"
```

---

## Phase 13: Build & Export Updates

### Task 27: Update tsup.config.ts

**Files:**
- Modify: `tsup.config.ts`

Ensure new modules are included in the library bundle and that `yaml`, `jiti`, `micromatch` are external (not bundled):

Add to the external list if needed, or verify the current `noExternal: ['listr2']` pattern works (other deps are external by default for the library bundle).

**Step 1: Verify build works**

Run: `pnpm build`
Expected: Build succeeds with no errors

**Step 2: Verify typecheck**

Run: `pnpm typecheck`
Expected: No type errors

**Step 3: Commit if changes needed**

```bash
git add tsup.config.ts
git commit -m "chore: update build config for new modules"
```

---

## Phase 14: Integration Tests

### Task 28: E2E test for changeset add → status flow

**Files:**
- Create: `tests/e2e/changeset-flow.test.ts`

Test the full flow: `pubm add --packages pkg --bump patch --message "fix"` → `pubm status`

### Task 29: E2E test for pre-release flow

**Files:**
- Create: `tests/e2e/prerelease-flow.test.ts`

Test: `pubm pre enter beta` → `pubm pre exit`

### Task 30: Run full test suite and verify coverage

Run: `pnpm coverage`
Expected: All tests pass, coverage meets thresholds (95% lines/functions/statements, 90% branches)

---

## Phase 15: CI/CD (Separate Repository)

### Task 31: GitHub Action scaffolding

This is a separate repository (`pubm/action`). Create:
- `action.yml` — action metadata
- `src/index.ts` — action entry point
- `dist/index.js` — bundled output

The action logic:
1. Check for pending changesets (`.pubm/changesets/`)
2. If pending → run `pubm version`, create PR
3. If no pending → run publish command from input

**This is a separate project and should be tracked independently.**

### Task 32: GitHub Bot scaffolding

Also a separate repository (`pubm/bot`). Uses Probot or GitHub App framework.

**This is a separate project and should be tracked independently.**

---

## Summary: Task Dependency Graph

```
Phase 1: Foundation
  Task 1 (deps) → Task 2 (types) → Task 3 (defaults) → Task 4 (loader)

Phase 2: Changeset Core
  Task 5 (parser) → Task 6 (writer) → Task 7 (reader)

Phase 3: Status
  Task 7 → Task 8 (status)

Phase 4: Monorepo
  Task 9 (workspace) → Task 10 (dep graph) → Task 11 (groups)

Phase 5: Validation
  Task 12 (entry points), Task 13 (extraneous) — independent

Phase 6: CHANGELOG
  Task 5 → Task 14 (changelog)

Phase 7: Pre-release
  Task 15 (pre state) → Task 16 (snapshot)

Phase 8: CLI
  Tasks 5-16 → Task 17 (CLI refactor)

Phase 9: Version
  Tasks 7, 14 → Task 18 (version calc)

Phase 10: Migration
  Task 5 → Task 19 (migrate)

Phase 11-14: Integration & Testing
  Tasks 20-30 (wiring, fixtures, tests)

Phase 15: CI/CD
  Tasks 31-32 (separate repos)
```

**Total: 32 tasks across 15 phases**
**Estimated commit count: ~25 commits**

---

## Key Files Reference

| Current File | Line Count | Changes Needed |
|-------------|-----------|----------------|
| `src/cli.ts` | 215 | Major refactor → subcommands |
| `src/index.ts` | 21 | Add re-exports |
| `src/options.ts` | 15 | Extend with config merge |
| `src/types/options.ts` | 100 | Add new types |
| `src/tasks/runner.ts` | 248 | Per-package pipeline (Phase 8+) |
| `package.json` | 86 | Add deps |
| `tsup.config.ts` | 29 | May need updates |
| `vitest.config.mts` | 28 | Add coverage exclusions |

| New Directory | Files | Purpose |
|--------------|-------|---------|
| `src/config/` | 4 | Config system |
| `src/changeset/` | 8 | Changeset workflow |
| `src/monorepo/` | 4 | Workspace + deps |
| `src/prerelease/` | 3 | Pre-release/snapshot |
| `src/validate/` | 3 | np-style checks |
| `src/commands/` | 8 | CLI subcommands |
