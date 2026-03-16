# Monorepo CI Release Workflow Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix CI release workflow for monorepo independent versioning — switch trigger from tag-based to commit-message-based, read versions from manifests instead of git tags, and add GitHub Release idempotency.

**Architecture:** Three changes: (1) workflow trigger from `v*` tag to main push with "Version Packages" commit condition, (2) `--ci`/`--publish-only` version logic reads from local manifests respecting `versioning` config, (3) `github-release.ts` skips 422 (already exists) instead of throwing.

**Tech Stack:** GitHub Actions YAML, TypeScript, Vitest

**Spec:** `docs/superpowers/specs/2026-03-16-monorepo-ci-release-workflow-design.md`

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `.github/workflows/release.yml` | Workflow trigger |
| Modify | `packages/pubm/src/cli.ts` | CI version determination logic |
| Modify | `packages/core/src/tasks/github-release.ts` | 422 idempotency |
| Modify | `packages/core/src/tasks/runner.ts` | Handle null return from createGitHubRelease |
| Modify | `packages/core/tests/unit/tasks/github-release.test.ts` | Tests for 422 skip |
| Modify | `packages/pubm/tests/e2e/ci-mode.test.ts` | Tests for manifest-based CI version |
| Modify | `plugins/pubm-plugin/skills/publish-setup/references/ci-templates.md` | Docs update |
| Modify | `plugins/pubm-plugin/skills/publish-setup/SKILL.md` | Docs update |

---

## Chunk 1: GitHub Release 422 Idempotency

### Task 1: Add 422 skip handling to `createGitHubRelease`

**Files:**
- Modify: `packages/core/src/tasks/github-release.ts:193-198`
- Test: `packages/core/tests/unit/tasks/github-release.test.ts`

- [ ] **Step 1: Write the failing test**

In `packages/core/tests/unit/tasks/github-release.test.ts`, the existing test "surfaces GitHub API failures when creating the release" uses a 422 response and expects it to throw. This test needs to be updated, and a new test added.

Add a new test BEFORE the existing 422 test:

```typescript
it("skips gracefully when the release already exists (HTTP 422)", async () => {
  const { createGitHubRelease } = await freshImport();
  const { mockExistsSync, mockGit } = await getMocks();

  mockExistsSync.mockReturnValue(false);
  mockGit.mockImplementation(function () {
    return {
      repository: vi
        .fn()
        .mockResolvedValue("https://github.com/pubm/pubm.git"),
      previousTag: vi.fn().mockResolvedValue("v0.9.0"),
      firstCommit: vi.fn().mockResolvedValue("first"),
      commits: vi.fn().mockResolvedValue([{ id: "skip", message: "skip" }]),
    } as any;
  } as any);

  global.fetch = vi.fn().mockResolvedValue({
    ok: false,
    status: 422,
    text: vi.fn().mockResolvedValue('{"message":"Validation Failed"}'),
  }) as any;

  const result = await createGitHubRelease({} as any, {
    packageName: "pubm",
    version: "1.0.0",
    tag: "v1.0.0",
  });

  expect(result).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && bun vitest --run tests/unit/tasks/github-release.test.ts`
Expected: FAIL — `createGitHubRelease` throws on 422 instead of returning null.

- [ ] **Step 3: Implement 422 skip in `github-release.ts`**

In `packages/core/src/tasks/github-release.ts`, change the error handling block at lines 193-198.

Replace:
```typescript
  if (!createResponse.ok) {
    const errorBody = await createResponse.text();
    throw new GitHubReleaseError(
      `Failed to create GitHub Release (${createResponse.status}): ${errorBody}`,
    );
  }
```

With:
```typescript
  if (createResponse.status === 422) {
    return null;
  }

  if (!createResponse.ok) {
    const errorBody = await createResponse.text();
    throw new GitHubReleaseError(
      `Failed to create GitHub Release (${createResponse.status}): ${errorBody}`,
    );
  }
```

Also update the return type of `createGitHubRelease` from `Promise<ReleaseContext>` to `Promise<ReleaseContext | null>`.

**Note:** The spec shows bare `return;` for the 422 case. We use `return null` instead so callers can explicitly distinguish "skipped" from "created" with a null check. This is a deliberate improvement over the spec.

- [ ] **Step 4: Update the existing 422 test**

The existing test "surfaces GitHub API failures when creating the release" uses status 422. Change it to use a different non-OK status (e.g., 500) since 422 now skips instead of throwing:

```typescript
it("surfaces GitHub API failures when creating the release", async () => {
  // ... same setup ...

  global.fetch = vi.fn().mockResolvedValue({
    ok: false,
    status: 500,
    text: vi.fn().mockResolvedValue("internal server error"),
  }) as any;

  await expect(
    createGitHubRelease({} as any, {
      packageName: "pubm",
      version: "1.0.0",
      tag: "v1.0.0",
    }),
  ).rejects.toThrow(
    /Failed to create GitHub Release \(500\): internal server error/,
  );
});
```

- [ ] **Step 5: Update callers of `createGitHubRelease` in runner.ts**

In `packages/core/src/tasks/runner.ts`, there are two call sites that need null handling:

**Call site 1 — independent mode (line ~659):**

Replace:
```typescript
                    const result = await createGitHubRelease(ctx, {
                      packageName: pkgName,
                      version: pkgVersion,
                      tag,
                      changelogBody,
                    });
                    task.output = `Release created: ${result.releaseUrl}`;
                    await ctx.runtime.pluginRunner.runAfterReleaseHook(
                      ctx,
                      result,
                    );
```

With:
```typescript
                    const result = await createGitHubRelease(ctx, {
                      packageName: pkgName,
                      version: pkgVersion,
                      tag,
                      changelogBody,
                    });
                    if (result) {
                      task.output = `Release created: ${result.releaseUrl}`;
                      await ctx.runtime.pluginRunner.runAfterReleaseHook(
                        ctx,
                        result,
                      );
                    } else {
                      task.output = `Release already exists for ${tag}, skipped.`;
                    }
```

**Call site 2 — single/fixed mode (line ~721):**

Replace:
```typescript
                  const result = await createGitHubRelease(ctx, {
                    packageName,
                    version,
                    tag,
                    changelogBody,
                  });
                  task.output = `Release created: ${result.releaseUrl}`;
                  await ctx.runtime.pluginRunner.runAfterReleaseHook(
                    ctx,
                    result,
                  );
```

With:
```typescript
                  const result = await createGitHubRelease(ctx, {
                    packageName,
                    version,
                    tag,
                    changelogBody,
                  });
                  if (result) {
                    task.output = `Release created: ${result.releaseUrl}`;
                    await ctx.runtime.pluginRunner.runAfterReleaseHook(
                      ctx,
                      result,
                    );
                  } else {
                    task.output = `Release already exists for ${tag}, skipped.`;
                  }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd packages/core && bun vitest --run tests/unit/tasks/github-release.test.ts`
Expected: All tests PASS.

- [ ] **Step 7: Commit**

```
git add packages/core/src/tasks/github-release.ts packages/core/tests/unit/tasks/github-release.test.ts packages/core/src/tasks/runner.ts
git commit -m "feat(core): skip GitHub Release creation when release already exists (422)"
```

---

## Chunk 2: CI Version Determination Logic

### Task 2: Change `--ci` / `--publish-only` to read from manifests

**Files:**
- Modify: `packages/pubm/src/cli.ts:212-244`
- Test: `packages/pubm/tests/e2e/ci-mode.test.ts`

- [ ] **Step 1: Update the `--ci` / `--publish-only` branch in cli.ts**

In `packages/pubm/src/cli.ts`, replace lines 212-244 (the `if (options.publishOnly || options.ci)` block):

Replace:
```typescript
            if (options.publishOnly || options.ci) {
              const git = new Git();
              const latestVersion = (await git.latestTag())?.slice(1);

              if (!latestVersion) {
                throw new Error(
                  "Cannot find the latest tag. Please ensure tags exist in the repository.",
                );
              }

              if (!valid(latestVersion)) {
                throw new Error(
                  "Cannot parse the latest tag to a valid SemVer version. Please check the tag format.",
                );
              }

              ctx.runtime.version = latestVersion;
              if (resolvedConfig.packages.length <= 1) {
                ctx.runtime.versionPlan = {
                  mode: "single",
                  version: latestVersion,
                  packageName: resolvedConfig.packages[0]?.name ?? "",
                };
              } else {
                const packages = new Map(
                  resolvedConfig.packages.map((p) => [p.name, latestVersion]),
                );
                ctx.runtime.versionPlan = {
                  mode: "fixed",
                  version: latestVersion,
                  packages,
                };
              }
            }
```

With:
```typescript
            if (options.publishOnly || options.ci) {
              const packages = new Map(
                resolvedConfig.packages.map((p) => [p.name, p.version]),
              );

              if (resolvedConfig.packages.length <= 1) {
                const [name, version] = [...packages][0];
                ctx.runtime.version = version;
                ctx.runtime.versionPlan = {
                  mode: "single",
                  version,
                  packageName: name,
                };
              } else if (resolvedConfig.versioning === "independent") {
                ctx.runtime.version = [...packages.values()][0];
                ctx.runtime.versions = packages;
                ctx.runtime.versionPlan = {
                  mode: "independent",
                  packages,
                };
              } else {
                const version = [...packages.values()][0];
                ctx.runtime.version = version;
                ctx.runtime.versionPlan = {
                  mode: "fixed",
                  version,
                  packages,
                };
              }
            }
```

- [ ] **Step 2: Remove unused imports from cli.ts**

`Git` (line 6) is only used at line 213 (inside the block being replaced). `valid` (line 29, destructured from semver) is only used at line 222. Both are now dead code. Remove them:

In the import block (line 2-16), remove `Git` from the `@pubm/core` import:
```typescript
import {
  calculateVersionBumps,
  consoleError,
  createContext,
  getStatus,
  loadConfig,
  notifyNewVersion,
  PUBM_VERSION,
  pubm,
  requiredMissingInformationTasks,
  resolveConfig,
  resolveOptions,
  ui,
} from "@pubm/core";
```

On line 29, remove `valid` from the semver destructure:
```typescript
const { RELEASE_TYPES } = semver;
```

- [ ] **Step 3: Update e2e test for `--publish-only` in non-git directory**

In `packages/pubm/tests/e2e/ci-mode.test.ts`, the test "should show error when --publish-only is used in a non-git directory" expects "Cannot find the latest tag". Since we no longer read from git tags, the error changes. The empty temp directory has no package.json, so config resolution will fail.

First run the test to identify the actual new error message:

Run: `cd packages/pubm && bun vitest --run tests/e2e/ci-mode.test.ts`

Then update the test assertion to match the actual error. For example, if the error is about missing config:

```typescript
it("should show error when --publish-only is used in a non-git directory", async () => {
  const tmpDir = path.join(
    process.env.TMPDIR || "/tmp",
    `pubm-ci-test-${Date.now()}`,
  );

  const { mkdirSync, rmSync } = await import("node:fs");
  mkdirSync(tmpDir, { recursive: true });

  try {
    const { stderr } = await runPubmCli(
      "bun",
      {
        nodeOptions: {
          env: { ...process.env, CI: "true" },
          cwd: tmpDir,
        },
      },
      cliPath,
      "--publish-only",
    );

    // In publish-only mode without a manifest, pubm fails during config resolution
    // Update the assertion below to match the actual error message after running
    expect(stderr.length).toBeGreaterThan(0);
    expect(stderr).toContain("Error");
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});
```

**Note:** The implementer must run the test first to discover the exact error message, then write a specific assertion. Do not leave it as just `expect(stderr.length).toBeGreaterThan(0)`.

- [ ] **Step 4: Add e2e test for single-package `--publish-only` reading from manifest**

In `packages/pubm/tests/e2e/ci-mode.test.ts`, add a test that creates a temp git repo with a package.json, runs `--publish-only`, and verifies it gets past version detection (the error should be about publish/registry, not about version/tag):

```typescript
it("should read version from manifest in --publish-only mode", async () => {
  const tmpDir = path.join(
    process.env.TMPDIR || "/tmp",
    `pubm-ci-manifest-${Date.now()}`,
  );

  const { mkdirSync, writeFileSync, rmSync } = await import("node:fs");
  const { execSync } = await import("node:child_process");
  mkdirSync(tmpDir, { recursive: true });

  try {
    // Set up a minimal git repo with package.json
    execSync("git init", { cwd: tmpDir });
    execSync('git config user.email "test@test.com"', { cwd: tmpDir });
    execSync('git config user.name "test"', { cwd: tmpDir });
    writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ name: "test-pkg", version: "1.0.0" }),
    );
    execSync("git add -A && git commit -m init", { cwd: tmpDir });

    const { stderr } = await runPubmCli(
      "bun",
      {
        nodeOptions: {
          env: { ...process.env, CI: "true" },
          cwd: tmpDir,
        },
      },
      cliPath,
      "--publish-only",
    );

    // Should NOT contain tag-related errors — version was read from manifest
    expect(stderr).not.toContain("Cannot find the latest tag");
    expect(stderr).not.toContain("Cannot parse the latest tag");
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 5: Add e2e test for monorepo independent versioning in `--ci` mode**

Add a test with a minimal monorepo setup (root package.json with workspaces, two sub-packages, and a pubm.config.ts):

```typescript
it("should support independent versioning in --ci mode", async () => {
  const tmpDir = path.join(
    process.env.TMPDIR || "/tmp",
    `pubm-ci-independent-${Date.now()}`,
  );

  const { mkdirSync, writeFileSync, rmSync } = await import("node:fs");
  const { execSync } = await import("node:child_process");
  mkdirSync(path.join(tmpDir, "packages", "a"), { recursive: true });
  mkdirSync(path.join(tmpDir, "packages", "b"), { recursive: true });

  try {
    // Root package.json with workspaces
    writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({
        name: "monorepo",
        private: true,
        workspaces: ["packages/*"],
      }),
    );
    // Sub-packages with different versions
    writeFileSync(
      path.join(tmpDir, "packages", "a", "package.json"),
      JSON.stringify({ name: "@test/a", version: "1.0.0" }),
    );
    writeFileSync(
      path.join(tmpDir, "packages", "b", "package.json"),
      JSON.stringify({ name: "@test/b", version: "2.0.0" }),
    );
    // pubm config with independent versioning
    writeFileSync(
      path.join(tmpDir, "pubm.config.ts"),
      `import { defineConfig } from "@pubm/core";
export default defineConfig({
  versioning: "independent",
  packages: [
    { path: "packages/a" },
    { path: "packages/b" },
  ],
});`,
    );

    execSync("git init", { cwd: tmpDir });
    execSync('git config user.email "test@test.com"', { cwd: tmpDir });
    execSync('git config user.name "test"', { cwd: tmpDir });
    execSync("git add -A && git commit -m init", { cwd: tmpDir });

    const { stderr } = await runPubmCli(
      "bun",
      {
        nodeOptions: {
          env: { ...process.env, CI: "true" },
          cwd: tmpDir,
        },
      },
      cliPath,
      "--ci",
    );

    // Should NOT contain tag-related errors
    expect(stderr).not.toContain("Cannot find the latest tag");
    expect(stderr).not.toContain("Cannot parse the latest tag");
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 6: Run all tests**

Run: `cd packages/pubm && bun vitest --run`
Expected: All tests PASS.

- [ ] **Step 7: Run format and typecheck**

Run: `bun run format && bun run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```
git add packages/pubm/src/cli.ts packages/pubm/tests/e2e/ci-mode.test.ts
git commit -m "feat(cli): read versions from manifests in --ci/--publish-only mode

Support independent versioning in CI by reading each package's version
from its manifest instead of deriving from git tags."
```

---

## Chunk 3: Workflow Trigger Change

### Task 3: Update `.github/workflows/release.yml`

**Files:**
- Modify: `.github/workflows/release.yml`

- [ ] **Step 1: Update the workflow trigger and add commit message condition**

Replace the entire `.github/workflows/release.yml` content:

```yaml
name: Release

on:
  push:
    branches:
      - main

permissions:
  contents: write
  id-token: write

jobs:
  release:
    if: startsWith(github.event.head_commit.message, 'Version Packages')
    environment: Publish
    permissions:
      contents: write
      id-token: write
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          registry-url: https://registry.npmjs.org/
      - run: bun install --frozen-lockfile
      - run: bun run build
      - name: Publish and release
        run: bunx pubm --ci
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NODE_AUTH_TOKEN }}
          JSR_TOKEN: ${{ secrets.JSR_TOKEN }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

- [ ] **Step 2: Commit**

```
git add .github/workflows/release.yml
git commit -m "ci: trigger release on Version Packages commit instead of v* tags

Monorepo independent versioning creates per-package tags (@pubm/core@0.4.0)
that don't match the v* pattern. Switch to commit-message based trigger."
```

---

## Chunk 4: publish-setup Skill Documentation Update

### Task 4: Update CI templates and skill documentation

**Files:**
- Modify: `plugins/pubm-plugin/skills/publish-setup/references/ci-templates.md`
- Modify: `plugins/pubm-plugin/skills/publish-setup/SKILL.md:142-155`

- [ ] **Step 1: Update `ci-templates.md` — How pubm Works in CI section**

In `plugins/pubm-plugin/skills/publish-setup/references/ci-templates.md`, replace lines 1-11 (the "How pubm Works in CI" section):

Replace:
```markdown
# CI/CD Templates for pubm

## How pubm Works in CI

pubm detects CI environments using the `std-env` package (`isCI` flag). When running in CI:

- Interactive prompts are disabled (`promptEnabled` is set to `false`).
- **Use `--ci` mode** for the full CI pipeline: publish + GitHub Release with assets. Alternatively, use `--publish-only` if you only need the publish step.
- Both modes read the latest git tag (via `git describe --tags --abbrev=0`), strip the `v` prefix, and use it as the publish version. The tag must already exist and be a valid semver.
- Authentication is handled entirely through environment variables (no interactive login).
```

With:
```markdown
# CI/CD Templates for pubm

## How pubm Works in CI

pubm detects CI environments using the `std-env` package (`isCI` flag). When running in CI:

- Interactive prompts are disabled (`promptEnabled` is set to `false`).
- **Use `--ci` mode** for the full CI pipeline: publish + GitHub Release with assets. Alternatively, use `--publish-only` if you only need the publish step.
- Both modes read each package's version from its local manifest (`package.json`, `jsr.json`, `Cargo.toml`). Packages whose version is already published on the registry are automatically skipped.
- In monorepo independent versioning mode, each package's version is read independently. Fixed mode uses a single shared version.
- Authentication is handled entirely through environment variables (no interactive login).
```

- [ ] **Step 2: Update `ci-templates.md` — add monorepo template**

After the "Template: GitHub Actions -- Tag-Based Auto Publish" section (after line 88), add a new template section:

```markdown
## Template: GitHub Actions -- Monorepo Auto Publish (Commit-Based)

For monorepos using pubm's changeset workflow with independent or fixed versioning. The workflow triggers when a "Version Packages" commit is pushed to main.

```yaml
# .github/workflows/publish.yml
name: Publish

on:
  push:
    branches:
      - main

permissions:
  contents: write
  id-token: write

jobs:
  publish:
    if: startsWith(github.event.head_commit.message, 'Version Packages')
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          registry-url: https://registry.npmjs.org

      - name: Install dependencies
        run: npm install

      - name: Install pubm
        run: npm install -g pubm

      - name: Publish to registries
        run: pubm --ci
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          NODE_AUTH_TOKEN: ${{ secrets.NODE_AUTH_TOKEN }}
          JSR_TOKEN: ${{ secrets.JSR_TOKEN }}
```

### Workflow

1. Develop and merge to main.
2. When ready to release, merge the "Version Packages" PR (created by pubm's changeset workflow).
3. The merged commit message starts with "Version Packages", triggering this workflow.
4. `pubm --ci` reads each package's manifest version, publishes unpublished packages, and creates GitHub Releases.

**Important:** This template requires merge commit or fast-forward merge strategy. Squash merges may alter the commit message and break the trigger condition.
```

- [ ] **Step 3: Update `ci-templates.md` — update the Notes section**

In the Notes section at the bottom, update the `fetch-depth` note:

Replace:
```markdown
- **`fetch-depth: 0`** is required on `actions/checkout` so that `git describe --tags --abbrev=0` can find the latest tag. Without full history, the tag lookup fails.
```

With:
```markdown
- **`fetch-depth: 0`** is recommended on `actions/checkout` for GitHub Release note generation, which uses git history to build commit-based release notes. For single-package tag-based workflows, it's also needed for tag lookup.
```

- [ ] **Step 4: Update `ci-templates.md` — update line 26**

Replace:
```markdown
Both modes require the git tag to already exist before running.
```

With:
```markdown
For tag-based workflows, the git tag must already exist before running. For commit-based monorepo workflows, tags are created locally and pushed alongside the commit.
```

- [ ] **Step 5: Update SKILL.md — CI setup section**

In `plugins/pubm-plugin/skills/publish-setup/SKILL.md`, update lines 145-148:

Replace:
```markdown
2. **Ask trigger method**:
   - **Tag-based** (recommended): push a `v*` tag to trigger publish
   - **Manual** (workflow_dispatch): trigger from the GitHub Actions UI
   - **Both**: supports both triggers
```

With:
```markdown
2. **Ask trigger method**:
   - **Tag-based** (recommended for single-package): push a `v*` tag to trigger publish
   - **Commit-based** (recommended for monorepo): trigger on "Version Packages" commit to main
   - **Manual** (workflow_dispatch): trigger from the GitHub Actions UI
   - **Both**: supports multiple triggers
```

- [ ] **Step 6: Commit**

```
git add plugins/pubm-plugin/skills/publish-setup/references/ci-templates.md plugins/pubm-plugin/skills/publish-setup/SKILL.md
git commit -m "docs(plugin): update CI templates for monorepo commit-based trigger

- Add monorepo auto-publish template with commit-message trigger
- Update --ci/--publish-only description to reflect manifest-based versioning
- Add commit-based trigger option to publish-setup skill"
```

---

## Chunk 5: Final Verification

### Task 5: Run full test suite and format check

- [ ] **Step 1: Run format**

Run: `bun run format`
Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 3: Run full test suite**

Run: `bun run test`
Expected: All tests PASS.

- [ ] **Step 4: Run coverage check**

Run: `bun run coverage`
Expected: Coverage thresholds met (95% lines/functions/statements, 90% branches).
