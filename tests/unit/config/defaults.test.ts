import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

import { existsSync } from 'node:fs';
import { resolveConfig } from '../../../src/config/defaults.js';
import type { PubmConfig } from '../../../src/config/types.js';

const mockedExistsSync = vi.mocked(existsSync);

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
    expect(resolved.validate.entryPoints).toBe(true);
  });

  it('detects single package when no workspace config', () => {
    const resolved = resolveConfig({});
    expect(resolved.packages).toEqual([
      { path: '.', registries: ['npm', 'jsr'] },
    ]);
  });
});
