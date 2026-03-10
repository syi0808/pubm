# Changesets Workflow Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make pubm's changeset features actually work end-to-end: interactive add, version recommendation in publish flow, CHANGELOG parsing, and CI integration.

**Architecture:** Extend existing changeset modules (`src/changeset/`) and integrate them into the publish pipeline (`src/tasks/required-missing-information.ts`, `src/cli.ts`). Add CHANGELOG parsing as a new utility. Use the existing `enquirer` + `listr2` prompt pattern throughout.

**Tech Stack:** TypeScript, enquirer (via `@listr2/prompt-adapter-enquirer`), listr2, semver, commander

---

## Task 1: CHANGELOG Parser

Add a utility to extract a specific version's section from CHANGELOG.md. This is needed by CI for GitHub Release body and by the new `changelog` subcommand.

**Files:**
- Create: `src/changeset/changelog-parser.ts`
- Test: `tests/unit/changeset/changelog-parser.test.ts`
- Modify: `src/changeset/index.ts:1-22` (add export)

**Step 1: Write the failing test**

```typescript
// tests/unit/changeset/changelog-parser.test.ts
import { describe, expect, it } from "vitest";
import { parseChangelogSection } from "../../src/changeset/changelog-parser.js";

describe("parseChangelogSection", () => {
  const changelog = `# Changelog

## 1.3.0

### Minor Changes

- Add custom changelog templates
- Support plugin hooks

### Patch Changes

- Fix typo in README

## 1.2.0

### Minor Changes

- Initial changeset support

## 1.1.0

### Patch Changes

- Bug fix
`;

  it("extracts a specific version section", () => {
    const result = parseChangelogSection(changelog, "1.3.0");
    expect(result).toContain("### Minor Changes");
    expect(result).toContain("- Add custom changelog templates");
    expect(result).toContain("### Patch Changes");
    expect(result).toContain("- Fix typo in README");
    expect(result).not.toContain("## 1.2.0");
  });

  it("returns null for non-existent version", () => {
    const result = parseChangelogSection(changelog, "9.9.9");
    expect(result).toBeNull();
  });

  it("handles version with v prefix in header", () => {
    const cl = `# Changelog\n\n## v2.0.0\n\n- Breaking change\n`;
    const result = parseChangelogSection(cl, "2.0.0");
    expect(result).toContain("- Breaking change");
  });

  it("handles last version in file (no next header)", () => {
    const result = parseChangelogSection(changelog, "1.1.0");
    expect(result).toContain("- Bug fix");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun vitest --run tests/unit/changeset/changelog-parser.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```typescript
// src/changeset/changelog-parser.ts

/**
 * Extract the content of a specific version section from a CHANGELOG.md string.
 * Looks for headers like `## 1.3.0` or `## v1.3.0`.
 * Returns the section content (without the header) or null if not found.
 */
export function parseChangelogSection(
  changelog: string,
  version: string,
): string | null {
  const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `^## v?${escapedVersion}\\b[^\\n]*\\n(.*?)(?=^## |\\z)`,
    "ms",
  );
  const match = changelog.match(pattern);
  if (!match) return null;
  return match[1].trim();
}
```

**Step 4: Run test to verify it passes**

Run: `bun vitest --run tests/unit/changeset/changelog-parser.test.ts`
Expected: PASS

**Step 5: Export from index**

Add to `src/changeset/index.ts`:
```typescript
export { parseChangelogSection } from "./changelog-parser.js";
```

**Step 6: Commit**

```bash
git add src/changeset/changelog-parser.ts tests/unit/changeset/changelog-parser.test.ts src/changeset/index.ts
git commit -m "feat(changeset): add CHANGELOG parser for version section extraction"
```

---

## Task 2: `pubm changesets changelog` Subcommand

Add a subcommand that previews or generates CHANGELOG content from pending changesets.

**Files:**
- Create: `src/commands/changelog.ts`
- Modify: `src/commands/changesets.ts:1-21` (register new command)

**Step 1: Write the failing test**

```typescript
// tests/unit/commands/changelog.test.ts
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { generateChangesetContent } from "../../src/changeset/writer.js";
import { runChangelogCommand } from "../../src/commands/changelog.js";

describe("runChangelogCommand", () => {
  const tmpDir = path.join(import.meta.dirname, ".tmp-changelog-test");
  const changesetsDir = path.join(tmpDir, ".pubm", "changesets");

  beforeEach(() => {
    mkdirSync(changesetsDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("generates changelog preview from pending changesets", async () => {
    const content = generateChangesetContent(
      [{ name: "test-pkg", type: "minor" }],
      "Add new feature",
    );
    writeFileSync(path.join(changesetsDir, "test-id.md"), content);

    const result = await runChangelogCommand(tmpDir, {
      dryRun: true,
      version: "1.1.0",
    });

    expect(result).toContain("## 1.1.0");
    expect(result).toContain("Add new feature");
  });

  it("returns null when no changesets exist", async () => {
    const result = await runChangelogCommand(tmpDir, {
      dryRun: true,
      version: "1.0.0",
    });

    expect(result).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun vitest --run tests/unit/commands/changelog.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```typescript
// src/commands/changelog.ts
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import type { Command } from "commander";
import type { ChangelogEntry } from "../changeset/changelog.js";
import { generateChangelog } from "../changeset/changelog.js";
import { readChangesets } from "../changeset/reader.js";

export interface ChangelogCommandOptions {
  dryRun?: boolean;
  version?: string;
}

export function runChangelogCommand(
  cwd: string,
  options: ChangelogCommandOptions,
): string | null {
  const changesets = readChangesets(cwd);
  if (changesets.length === 0) return null;

  const versionHeader = options.version ?? "Unreleased";

  const entries: ChangelogEntry[] = [];
  for (const changeset of changesets) {
    for (const release of changeset.releases) {
      entries.push({
        summary: changeset.summary,
        type: release.type,
        id: changeset.id,
      });
    }
  }

  const content = generateChangelog(versionHeader, entries);

  if (!options.dryRun) {
    const changelogPath = path.join(cwd, "CHANGELOG.md");
    let existing = "";
    if (existsSync(changelogPath)) {
      existing = readFileSync(changelogPath, "utf-8");
    }

    const header = "# Changelog\n\n";
    const body = existing.startsWith("# Changelog")
      ? existing.slice(existing.indexOf("\n\n") + 2)
      : existing;

    writeFileSync(changelogPath, `${header}${content}\n${body}`, "utf-8");
  }

  return content;
}

export function registerChangelogCommand(parent: Command): void {
  parent
    .command("changelog")
    .description("Generate CHANGELOG from pending changesets")
    .option("--dry-run", "Preview without writing to file")
    .option("--version <ver>", "Version header for the changelog section")
    .action(async (options: { dryRun?: boolean; version?: string }) => {
      const result = runChangelogCommand(process.cwd(), options);

      if (!result) {
        console.log("No pending changesets to generate changelog from.");
        return;
      }

      console.log(result);

      if (!options.dryRun) {
        console.log("\nChangelog written to CHANGELOG.md");
      }
    });
}
```

**Step 4: Run test to verify it passes**

Run: `bun vitest --run tests/unit/commands/changelog.test.ts`
Expected: PASS

**Step 5: Register in changesets command**

In `src/commands/changesets.ts`, add:
```typescript
import { registerChangelogCommand } from "./changelog.js";
// ...
registerChangelogCommand(changesets);
```

**Step 6: Commit**

```bash
git add src/commands/changelog.ts tests/unit/commands/changelog.test.ts src/commands/changesets.ts
git commit -m "feat(changeset): add changelog subcommand for preview and generation"
```

---

## Task 3: Interactive `pubm changesets add`

Replace the "coming soon" placeholder with a real interactive flow using enquirer prompts.

**Files:**
- Modify: `src/commands/add.ts:1-51`

**Step 1: Write the failing test**

```typescript
// tests/unit/commands/add.test.ts
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseChangeset } from "../../src/changeset/parser.js";

describe("add command - non-interactive", () => {
  const tmpDir = path.join(import.meta.dirname, ".tmp-add-test");

  beforeEach(() => {
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates changeset with --packages, --bump, --message flags", async () => {
    const { writeChangeset } = await import("../../src/changeset/writer.js");
    const filePath = writeChangeset(
      [{ name: "my-pkg", type: "minor" }],
      "Add cool feature",
      tmpDir,
    );

    expect(existsSync(filePath)).toBe(true);

    const content = readFileSync(filePath, "utf-8");
    const changeset = parseChangeset(content, path.basename(filePath, ".md"));
    expect(changeset.releases[0].name).toBe("my-pkg");
    expect(changeset.releases[0].type).toBe("minor");
    expect(changeset.summary).toBe("Add cool feature");
  });
});
```

**Step 2: Run test to verify it passes (existing functionality)**

Run: `bun vitest --run tests/unit/commands/add.test.ts`
Expected: PASS (this verifies existing non-interactive mode works)

**Step 3: Implement interactive mode**

Replace `src/commands/add.ts` with:

```typescript
import process from "node:process";
import type { Command } from "commander";
import Enquirer from "enquirer";
import type { BumpType, Release } from "../changeset/parser.js";
import { writeChangeset } from "../changeset/writer.js";
import { discoverPackages } from "../monorepo/discover.js";
import { getPackageJson } from "../utils/package.js";

const BUMP_CHOICES = [
  { name: "patch", message: "patch — Bug fixes, no API changes" },
  { name: "minor", message: "minor — New features, backward compatible" },
  { name: "major", message: "major — Breaking changes" },
];

async function interactiveAdd(cwd: string): Promise<void> {
  const enquirer = new Enquirer();

  // Detect packages
  const discovered = discoverPackages({ cwd });
  let packages: { name: string; version: string }[];

  if (discovered.length > 1) {
    // Monorepo: read each package's name and version
    const pkgInfos = await Promise.all(
      discovered.map(async (pkg) => {
        const pkgJson = await getPackageJson({ cwd: `${cwd}/${pkg.path}` });
        return { name: pkgJson.name ?? pkg.path, version: pkgJson.version ?? "0.0.0" };
      }),
    );
    packages = pkgInfos;
  } else {
    // Single package
    const pkgJson = await getPackageJson({ cwd });
    packages = [{ name: pkgJson.name ?? "package", version: pkgJson.version ?? "0.0.0" }];
  }

  // Step 1: Select packages (skip for single package)
  let selectedPackages: string[];
  if (packages.length === 1) {
    selectedPackages = [packages[0].name];
    console.log(`\n📦 ${packages[0].name} (v${packages[0].version})\n`);
  } else {
    const { selected } = await enquirer.prompt<{ selected: string[] }>({
      type: "multiselect",
      name: "selected",
      message: "Select packages to include in this changeset",
      choices: packages.map((pkg) => ({
        name: pkg.name,
        message: `${pkg.name} (v${pkg.version})`,
      })),
    });
    selectedPackages = selected;

    if (selectedPackages.length === 0) {
      console.log("No packages selected. Aborting.");
      return;
    }
  }

  // Step 2: Select bump type for each package
  const releases: Release[] = [];
  for (const pkgName of selectedPackages) {
    const { bump } = await enquirer.prompt<{ bump: BumpType }>({
      type: "select",
      name: "bump",
      message: `Bump type for ${pkgName}`,
      choices: BUMP_CHOICES,
    });
    releases.push({ name: pkgName, type: bump });
  }

  // Step 3: Enter summary
  const { summary } = await enquirer.prompt<{ summary: string }>({
    type: "input",
    name: "summary",
    message: "Summary of changes",
  });

  if (!summary.trim()) {
    console.log("Empty summary. Aborting.");
    return;
  }

  // Step 4: Write changeset
  const filePath = writeChangeset(releases, summary.trim(), cwd);
  const fileName = filePath.split("/").pop();
  console.log(`\n✅ Created changeset: ${fileName}`);
  console.log(`   ${filePath}`);
}

export function registerAddCommand(parent: Command): void {
  parent
    .command("add")
    .description("Create a new changeset")
    .option("--empty", "Create an empty changeset")
    .option("--packages <list>", "Comma-separated package names")
    .option("--bump <type>", "Bump type: patch, minor, major")
    .option("--message <text>", "Changeset summary")
    .action(
      async (options: {
        empty?: boolean;
        packages?: string;
        bump?: string;
        message?: string;
      }) => {
        if (options.empty) {
          const filePath = writeChangeset([], "");
          console.log(`Created empty changeset: ${filePath}`);
          return;
        }

        if (options.packages && options.bump && options.message) {
          const VALID_BUMP_TYPES = new Set(["patch", "minor", "major"]);
          if (!VALID_BUMP_TYPES.has(options.bump)) {
            throw new Error(
              `Invalid bump type "${options.bump}". Expected: patch, minor, or major.`,
            );
          }
          const packages = options.packages
            .split(",")
            .map((p: string) => p.trim());
          const releases = packages.map((name: string) => ({
            name,
            type: options.bump as BumpType,
          }));
          const filePath = writeChangeset(releases, options.message);
          console.log(`Created changeset: ${filePath}`);
          return;
        }

        // Interactive mode
        await interactiveAdd(process.cwd());
      },
    );
}
```

**Step 4: Run format and typecheck**

Run: `bun run format && bun run typecheck`
Expected: PASS

**Step 5: Commit**

```bash
git add src/commands/add.ts
git commit -m "feat(changeset): implement interactive add with package selection and bump type prompts"
```

---

## Task 4: Changeset-Aware Version Prompt

Modify `required-missing-information.ts` to detect pending changesets and recommend versions before falling back to manual selection.

**Files:**
- Modify: `src/tasks/required-missing-information.ts:1-110`

**Step 1: Understand current flow**

Current flow in `src/cli.ts:126-154`:
1. `requiredMissingInformationTasks().run(context)` — prompts for version + tag
2. `pubm(resolveCliOptions(...))` — runs publish pipeline

The `requiredMissingInformationTasks` checks `ctx.version` and skips if already set. We need to add changeset detection before the version prompt.

**Step 2: Implement changeset-aware version prompt**

Replace `src/tasks/required-missing-information.ts`:

```typescript
import process from "node:process";
import { ListrEnquirerPromptAdapter } from "@listr2/prompt-adapter-enquirer";
import { color, type Listr, type ListrTask } from "listr2";
import semver from "semver";
import { readChangesets } from "../changeset/reader.js";
import { getStatus } from "../changeset/status.js";
import { calculateVersionBumps } from "../changeset/version.js";
import { defaultOptions } from "../options.js";
import { jsrRegistry } from "../registry/jsr.js";
import { npmRegistry } from "../registry/npm.js";
import { createListr } from "../utils/listr.js";
import { getPackageJson, version } from "../utils/package.js";

const { RELEASE_TYPES, SemVer, prerelease } = semver;

interface Ctx {
  version?: string;
  tag: string;
  changesetConsumed?: boolean;
}

export const requiredMissingInformationTasks = (
  options?: Omit<ListrTask<Ctx>, "title" | "task">,
): Listr<Ctx> =>
  createListr<Ctx>({
    ...options,
    title: "Checking required information",
    task: (_, parentTask): Listr<Ctx> =>
      parentTask.newListr([
        {
          title: "Checking version information",
          skip: (ctx) => !!ctx.version,
          task: async (ctx, task): Promise<void> => {
            const currentVersion = await version();
            const cwd = process.cwd();

            // Check for pending changesets
            const status = getStatus(cwd);

            if (status.hasChangesets) {
              // Show current package info
              const pkgJson = await getPackageJson({ cwd });
              const pkgName = pkgJson.name ?? "package";

              // Calculate recommended version from changesets
              const currentVersions = new Map<string, string>([
                [pkgName, currentVersion],
              ]);
              const bumps = calculateVersionBumps(currentVersions, cwd);
              const bump = bumps.get(pkgName);

              if (bump) {
                // Show changeset summary
                task.output = `📦 ${pkgName} ${color.dim(`v${currentVersion}`)}`;

                const statusInfo = status.packages.get(pkgName);
                const changesetCount = statusInfo?.changesetCount ?? 0;
                const bumpType = statusInfo?.bumpType ?? bump.bumpType;

                const accept = await task
                  .prompt(ListrEnquirerPromptAdapter)
                  .run<string>({
                    type: "select",
                    message: `Changesets suggest: ${currentVersion} → ${color.green(bump.newVersion)} (${bumpType}, ${changesetCount} changeset${changesetCount !== 1 ? "s" : ""})`,
                    choices: [
                      {
                        message: `Accept ${color.green(bump.newVersion)}`,
                        name: "accept",
                      },
                      {
                        message: "Choose a different version",
                        name: "customize",
                      },
                    ],
                    name: "accept",
                  });

                if (accept === "accept") {
                  ctx.version = bump.newVersion;
                  ctx.changesetConsumed = true;
                  return;
                }
                // Fall through to manual selection
              }
            }

            // Manual version selection (existing behavior)
            let nextVersion = await task
              .prompt(ListrEnquirerPromptAdapter)
              .run<string>({
                type: "select",
                message: `Select SemVer increment or specify new version ${color.dim(`(current: ${currentVersion})`)}`,
                choices: RELEASE_TYPES.map((releaseType) => {
                  const increasedVersion = new SemVer(currentVersion)
                    .inc(releaseType)
                    .toString();

                  return {
                    message: `${releaseType} ${color.dim(increasedVersion)}`,
                    name: increasedVersion,
                  };
                }).concat([
                  { message: "Custom version (specify)", name: "specify" },
                ]),
                name: "version",
              });

            if (nextVersion === "specify") {
              nextVersion = await task
                .prompt(ListrEnquirerPromptAdapter)
                .run<string>({
                  type: "input",
                  message: "Version",
                  name: "version",
                });
            }

            ctx.version = nextVersion;
          },
          exitOnError: true,
        },
        {
          title: "Checking tag information",
          skip: (ctx) =>
            !prerelease(`${ctx.version}`) && ctx.tag === defaultOptions.tag,
          task: async (ctx, task): Promise<void> => {
            const npm = await npmRegistry();
            const jsr = await jsrRegistry();
            const distTags = [
              ...new Set(
                (await Promise.all([npm.distTags(), jsr.distTags()])).flat(),
              ),
            ].filter((tag) => tag !== defaultOptions.tag);

            if (distTags.length <= 0) distTags.push("next");

            let tag = await task
              .prompt(ListrEnquirerPromptAdapter)
              .run<string>({
                type: "select",
                message: "Select the tag for this pre-release version in npm",
                choices: distTags
                  .map((distTag) => ({
                    message: distTag,
                    name: distTag,
                  }))
                  .concat([
                    { message: "Custom version (specify)", name: "specify" },
                  ]),
                name: "tag",
              });

            if (tag === "specify") {
              tag = await task
                .prompt(ListrEnquirerPromptAdapter)
                .run<string>({
                  type: "input",
                  message: "Tag",
                  name: "tag",
                });
            }

            ctx.tag = tag;
          },
          exitOnError: true,
        },
      ]),
  });
```

**Step 3: Run format and typecheck**

Run: `bun run format && bun run typecheck`
Expected: PASS

**Step 4: Commit**

```bash
git add src/tasks/required-missing-information.ts
git commit -m "feat: add changeset-aware version recommendation in interactive prompt"
```

---

## Task 5: Consume Changesets in Version Bump Task

When `changesetConsumed` is true in context, consume changesets (delete files + write CHANGELOG) during the version bump task in `runner.ts`.

**Files:**
- Modify: `src/tasks/runner.ts:296-358` (version bump task)
- Modify: `src/tasks/runner.ts:1-43` (imports)
- Modify: `src/types/options.ts` (add `changesetConsumed` to context)
- Modify: `src/cli.ts:120-155` (pass `changesetConsumed` through)

**Step 1: Add `changesetConsumed` to context flow**

In `src/cli.ts`, the context object flows from `requiredMissingInformationTasks` to `pubm()`. Add `changesetConsumed` to the context:

```typescript
// In src/cli.ts action handler, after requiredMissingInformationTasks().run(context):
const resolvedOptions = resolveCliOptions({
  ...options,
  version: context.version,
  tag: context.tag,
  changesetConsumed: context.changesetConsumed,
} as CliOptions);
```

Add `changesetConsumed?: boolean` to `Options` interface in `src/types/options.ts`.

**Step 2: Modify runner.ts version bump task**

In the "Bumping version" task (line 296-358 of `runner.ts`), add changeset consumption as parallel work:

After `replaceVersion()` and before the git commit, add:

```typescript
// In the "Bumping version" task, after replaceVersion:
if (ctx.changesetConsumed) {
  const changesets = readChangesets(process.cwd());
  if (changesets.length > 0) {
    // Build changelog entries
    const entries: ChangelogEntry[] = [];
    for (const changeset of changesets) {
      for (const release of changeset.releases) {
        entries.push({
          summary: changeset.summary,
          type: release.type,
          id: changeset.id,
        });
      }
    }

    // Generate and write CHANGELOG
    const changelogContent = generateChangelog(`${ctx.version}`, entries);
    writeChangelog(process.cwd(), changelogContent);

    // Delete consumed changeset files
    deleteChangesetFiles(process.cwd(), changesets);
  }
}
```

Import the necessary functions at the top of `runner.ts`:

```typescript
import type { ChangelogEntry } from "../changeset/changelog.js";
import { generateChangelog } from "../changeset/changelog.js";
import { readChangesets } from "../changeset/reader.js";
```

Extract `writeChangelog` and `deleteChangesetFiles` from `version-cmd.ts` into shared utilities (or import from version-cmd if already exported).

**Step 3: Extract shared changelog/delete utilities**

Move `writeChangelog` and `deleteChangesetFiles` from `src/commands/version-cmd.ts` to `src/changeset/changelog.ts` and `src/changeset/reader.ts` respectively, and export them. Update `version-cmd.ts` to import from there.

Add to `src/changeset/changelog.ts`:
```typescript
export function writeChangelogToFile(cwd: string, newContent: string): void {
  const changelogPath = path.join(cwd, "CHANGELOG.md");
  let existing = "";
  if (existsSync(changelogPath)) {
    existing = readFileSync(changelogPath, "utf-8");
  }
  const header = "# Changelog\n\n";
  const body = existing.startsWith("# Changelog")
    ? existing.slice(existing.indexOf("\n\n") + 2)
    : existing;
  writeFileSync(changelogPath, `${header}${newContent}\n${body}`, "utf-8");
}
```

Add to `src/changeset/reader.ts`:
```typescript
export function deleteChangesetFiles(cwd: string, changesets: Changeset[]): void {
  const changesetsDir = path.join(cwd, ".pubm", "changesets");
  for (const changeset of changesets) {
    const filePath = path.join(changesetsDir, `${changeset.id}.md`);
    if (existsSync(filePath)) {
      rmSync(filePath);
    }
  }
}
```

**Step 4: Run format, typecheck, and tests**

Run: `bun run format && bun run typecheck && bun run test`
Expected: PASS

**Step 5: Commit**

```bash
git add src/tasks/runner.ts src/cli.ts src/types/options.ts src/changeset/changelog.ts src/changeset/reader.ts src/commands/version-cmd.ts src/changeset/index.ts
git commit -m "feat: consume changesets during version bump when recommended version is accepted"
```

---

## Task 6: CI Changeset Auto-Detection

In CI mode, detect pending changesets and auto-determine version instead of requiring a git tag.

**Files:**
- Modify: `src/cli.ts:129-151` (CI mode logic)

**Step 1: Understand current CI flow**

Current CI logic in `cli.ts:129-151`:
- If `--ci` or `--publish-only`: reads version from latest git tag
- Otherwise: throws "Version must be set in the CI environment"

**Step 2: Add changeset detection in CI**

Modify the CI branch to check for changesets before falling back to tag:

```typescript
// In cli.ts, the isCI block:
} else if (isCI) {
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

    context.version = latestVersion;
  } else {
    // Check for pending changesets
    const status = getStatus(process.cwd());
    if (status.hasChangesets) {
      const pkgJson = await getPackageJson();
      const pkgName = pkgJson.name ?? "unknown";
      const currentVersion = pkgJson.version;

      if (!currentVersion) {
        throw new Error("No version found in package.json");
      }

      const currentVersions = new Map([[pkgName, currentVersion]]);
      const bumps = calculateVersionBumps(currentVersions, process.cwd());
      const bump = bumps.get(pkgName);

      if (bump) {
        context.version = bump.newVersion;
        context.changesetConsumed = true;
        console.log(
          `Changesets detected: ${currentVersion} → ${bump.newVersion} (${bump.bumpType})`,
        );
      }
    }

    if (!context.version) {
      throw new Error(
        "Version must be set in the CI environment. Please define the version before proceeding.",
      );
    }
  }
}
```

**Step 3: Add necessary imports to cli.ts**

```typescript
import { getStatus } from "./changeset/status.js";
import { calculateVersionBumps } from "./changeset/version.js";
import { getPackageJson } from "./utils/package.js";
```

**Step 4: Run format and typecheck**

Run: `bun run format && bun run typecheck`
Expected: PASS

**Step 5: Commit**

```bash
git add src/cli.ts
git commit -m "feat: auto-detect changesets in CI mode for version determination"
```

---

## Task 7: CI GitHub Release with CHANGELOG Content

When creating GitHub Release in CI mode, use CHANGELOG.md content for the release body instead of commit list.

**Files:**
- Modify: `src/tasks/github-release.ts` (or wherever GitHub Release is created in CI mode)

**Step 1: Read current GitHub Release implementation**

Read `src/tasks/github-release.ts` to understand how CI release body is constructed.

**Step 2: Add CHANGELOG-based release body**

After version bump consumes changesets and writes CHANGELOG, the CI publish step should:
1. Read CHANGELOG.md
2. Parse the current version's section using `parseChangelogSection`
3. Use that as the GitHub Release body

In the CI publish task (runner.ts lines 228-231), modify `createGitHubRelease` to accept changelog content:

```typescript
// In the CI "Creating GitHub Release" task:
{
  title: "Creating GitHub Release",
  task: async (ctx): Promise<void> => {
    // Try to get changelog content for release body
    let changelogBody: string | undefined;
    const changelogPath = path.join(process.cwd(), "CHANGELOG.md");
    if (existsSync(changelogPath)) {
      const changelogContent = readFileSync(changelogPath, "utf-8");
      const section = parseChangelogSection(changelogContent, ctx.version);
      if (section) {
        changelogBody = section;
      }
    }

    const result = await createGitHubRelease(ctx, changelogBody);
    ctx.releaseContext = result;
  },
},
```

This requires reading `createGitHubRelease` first to understand its signature and modify it to accept optional body content.

**Step 3: Run format, typecheck, and tests**

Run: `bun run format && bun run typecheck && bun run test`
Expected: PASS

**Step 4: Commit**

```bash
git add src/tasks/runner.ts src/tasks/github-release.ts
git commit -m "feat: use CHANGELOG content for GitHub Release body in CI mode"
```

---

## Task 8: Verify End-to-End Flow

Manual verification of the complete changeset workflow.

**Step 1: Test interactive add**

```bash
cd /tmp && mkdir test-pubm && cd test-pubm
npm init -y
# Set up minimal pubm config
bun x pubm changesets add
# Verify interactive prompts work
# Verify .pubm/changesets/<id>.md is created
```

**Step 2: Test changeset status**

```bash
bun x pubm changesets status
bun x pubm changesets status --verbose
# Verify output shows pending changesets
```

**Step 3: Test changelog preview**

```bash
bun x pubm changesets changelog --dry-run --version 1.1.0
# Verify changelog output
```

**Step 4: Test version recommendation in publish flow**

```bash
bun x pubm --preview
# Verify: shows changeset recommendation before version prompt
# Verify: accepting recommendation sets correct version
```

**Step 5: Run full test suite**

Run: `bun run check && bun run typecheck && bun run test`
Expected: All pass

**Step 6: Commit any fixes**

```bash
git add -A
git commit -m "fix: address issues found during e2e verification"
```

---

## Task 9: Code Cleanup

Review and clean up any duplication or dead code introduced during implementation.

**Step 1: Check for duplicate changelog write logic**

- `src/commands/version-cmd.ts` has `writeChangelog` (now should import from shared)
- `src/commands/changelog.ts` has similar logic (should import from shared)
- `src/tasks/runner.ts` uses shared utility

Ensure all three use `writeChangelogToFile` from `src/changeset/changelog.ts`.

**Step 2: Remove dead code**

- Remove old `writeChangelog` and `deleteChangesetFiles` from `version-cmd.ts` if moved to shared modules
- Remove "coming soon" comment from `add.ts`

**Step 3: Run pre-commit checklist**

Run: `bun run format && bun run typecheck && bun run test`
Expected: All pass

**Step 4: Commit**

```bash
git add -A
git commit -m "refactor: deduplicate changelog and changeset file utilities"
```
