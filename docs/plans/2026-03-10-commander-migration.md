# CAC → Commander.js Migration + Changesets Command Group

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace CAC with Commander.js and reorganize changeset-related commands under `pubm changesets` subcommand group.

**Architecture:** Replace the flat CAC command registration with Commander.js's native nested subcommand support. All 6 changeset commands (`add`, `status`, `version`, `pre`, `snapshot`, `migrate`) become subcommands of `pubm changesets`. The remaining commands (`init`, `update`, `secrets`, `sync`) and the default publish command stay at top level. Each command file exports a function that receives a `Command` instance and registers itself.

**Tech Stack:** Commander.js, TypeScript, Vitest, Bun

---

### Task 1: Swap dependency

**Files:**
- Modify: `package.json`

**Step 1: Install Commander.js and remove CAC**

Run:
```bash
bun remove cac && bun add commander
```

**Step 2: Verify installation**

Run: `bun install`
Expected: No errors, `commander` in node_modules

**Step 3: Commit**

```bash
git add package.json bun.lock
git commit -m "chore: replace cac with commander"
```

---

### Task 2: Rewrite CLI entry point

**Files:**
- Modify: `src/cli.ts`

**Step 1: Rewrite `src/cli.ts` with Commander.js**

Replace the entire file. Key changes:
- `import { Command } from "commander"` instead of cac
- `new Command("pubm")` instead of `cac("pubm")`
- Default command uses `.argument("[version]")` for positional arg
- `--no-*` options work identically in Commander.js
- `.configureOutput()` for custom error messages
- Register subcommands via the same `register*Command(program)` pattern

The `resolveCliOptions` function stays the same — it's pure logic.

```typescript
import { Command } from "commander";
import semver from "semver";
import { isCI } from "std-env";
import { registerChangesetsCommand } from "./commands/changesets.js";
import { registerInitCommand } from "./commands/init.js";
import { registerSecretsCommand } from "./commands/secrets.js";
import { registerSyncCommand } from "./commands/sync.js";
import { registerUpdateCommand } from "./commands/update.js";
import { consoleError } from "./error.js";
import { Git } from "./git.js";
import { pubm } from "./index.js";
import { requiredMissingInformationTasks } from "./tasks/required-missing-information.js";
import type { Options } from "./types/options.js";
import { notifyNewVersion } from "./utils/notify-new-version.js";
import { version } from "./utils/package.js";

const { RELEASE_TYPES, valid } = semver;

interface CliOptions {
  version: string;
  testScript: string;
  preview?: boolean;
  branch: string;
  anyBranch?: boolean;
  preCheck: boolean;
  conditionCheck: boolean;
  tests: boolean;
  build: boolean;
  publish: boolean;
  publishOnly: boolean;
  preflight?: boolean;
  releaseDraft: boolean;
  tag: string;
  contents?: string;
  registry?: string;
  saveToken: boolean;
}

export function resolveCliOptions(options: CliOptions): Options {
  return {
    ...options,
    skipPublish: !options.publish,
    skipReleaseDraft: !options.releaseDraft,
    skipTests: !options.tests,
    skipBuild: !options.build,
    registries: options.registry?.split(","),
    skipPrerequisitesCheck: !options.preCheck,
    skipConditionsCheck: !options.conditionCheck,
    preflight: options.preflight,
  };
}

const program = new Command("pubm");

// Register subcommands
registerChangesetsCommand(program);
registerInitCommand(program);
registerUpdateCommand(program);
registerSecretsCommand(program);
registerSyncCommand(program);

// Default command: publish
program
  .argument("[version]", `Version: ${RELEASE_TYPES.join(" | ")} | 1.2.3`)
  .option("--test-script <script>", "The npm script to run tests before publishing", "test")
  .option("--build-script <script>", "The npm script to run build before publishing", "build")
  .option("-p, --preview", "Show tasks without actually executing publish")
  .option("-b, --branch <name>", "Name of the release branch", "main")
  .option("-a, --any-branch", "Allow publishing from any branch")
  .option("--no-pre-check", "Skip prerequisites check task")
  .option("--no-condition-check", "Skip required conditions check task")
  .option("--no-tests", "Skip running tests before publishing")
  .option("--no-build", "Skip build before publishing")
  .option("--no-publish", "Skip publishing task")
  .option("--no-release-draft", "Skip creating a GitHub release draft")
  .option("--publish-only", "Run only publish task for latest tag")
  .option("--preflight", "Simulate CI publish locally (dry-run with token-based auth)")
  .option("-t, --tag <name>", "Publish under a specific dist-tag", "latest")
  .option("-c, --contents <path>", "Subdirectory to publish")
  .option("--no-save-token", "Do not save jsr tokens (request the token each time)")
  .option(
    "--registry <registries>",
    "Target registries for publish\n    registry can be npm | jsr | https://url.for.private-registries",
    "npm,jsr",
  )
  .action(async (nextVersion: string | undefined, options: Omit<CliOptions, "version">) => {
    console.clear();

    if (!isCI) {
      await notifyNewVersion();
    }

    const context = {
      version: nextVersion,
      tag: options.tag,
    };

    try {
      if (options.preflight) {
        await requiredMissingInformationTasks().run(context);
      } else if (isCI) {
        if (options.publishOnly) {
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
          throw new Error(
            "Version must be set in the CI environment. Please define the version before proceeding.",
          );
        }
      } else {
        await requiredMissingInformationTasks().run(context);
      }

      await pubm(
        resolveCliOptions({
          ...options,
          version: context.version,
          tag: context.tag,
        } as CliOptions),
      );
    } catch (e) {
      consoleError(e as Error);
      process.exitCode = 1;
    }
  });

(async () => {
  program.version(await version({ cwd: import.meta.dirname }));
  await program.parseAsync();
})();
```

**Step 2: Verify typecheck**

Run: `bun run typecheck`
Expected: No errors related to cli.ts (there will be errors in command files since they still import CAC — that's expected at this point)

---

### Task 3: Create `pubm changesets` command group

**Files:**
- Create: `src/commands/changesets.ts` (parent group)
- Modify: `src/commands/add.ts`
- Modify: `src/commands/status.ts`
- Modify: `src/commands/version-cmd.ts`
- Modify: `src/commands/pre.ts`
- Modify: `src/commands/snapshot.ts`
- Modify: `src/commands/migrate.ts`

**Step 1: Create the changesets parent command**

Create `src/commands/changesets.ts`:

```typescript
import type { Command } from "commander";
import { registerAddCommand } from "./add.js";
import { registerMigrateCommand } from "./migrate.js";
import { registerPreCommand } from "./pre.js";
import { registerSnapshotCommand } from "./snapshot.js";
import { registerStatusCommand } from "./status.js";
import { registerVersionCommand } from "./version-cmd.js";

export function registerChangesetsCommand(program: Command): void {
  const changesets = program
    .command("changesets")
    .description("Manage changesets");

  registerAddCommand(changesets);
  registerStatusCommand(changesets);
  registerVersionCommand(changesets);
  registerPreCommand(changesets);
  registerSnapshotCommand(changesets);
  registerMigrateCommand(changesets);
}
```

**Step 2: Migrate each command file from CAC to Commander**

Each file changes:
- `import type { CAC } from "cac"` → `import type { Command } from "commander"`
- `cli.command("name", "desc").option(...).action(...)` → `parent.command("name").description("desc").option(...).action(...)`
- Parameter type: `(cli: CAC)` → `(parent: Command)`

**`src/commands/add.ts`:**
```typescript
import type { Command } from "commander";
import type { BumpType } from "../changeset/parser.js";
import { writeChangeset } from "../changeset/writer.js";

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

        console.log(
          "Interactive changeset creation coming soon. Use --packages, --bump, and --message flags for now.",
        );
      },
    );
}
```

**`src/commands/status.ts`:**
```typescript
import type { Command } from "commander";
import { getStatus } from "../changeset/status.js";

export function registerStatusCommand(parent: Command): void {
  parent
    .command("status")
    .description("Show pending changeset status")
    .option("--verbose", "Show full changeset contents")
    .option("--since <ref>", "Only check changesets since git ref")
    .action(async (options: { verbose?: boolean; since?: string }) => {
      const status = getStatus();

      if (!status.hasChangesets) {
        if (options.since) {
          console.log("No changesets found.");
          process.exit(1);
        }
        console.log("No pending changesets.");
        return;
      }

      console.log("Pending changesets:");
      for (const [name, info] of status.packages) {
        console.log(
          `  ${name}: ${info.bumpType} (${info.changesetCount} changeset${info.changesetCount > 1 ? "s" : ""})`,
        );
        if (options.verbose) {
          for (const summary of info.summaries) {
            console.log(`    - ${summary}`);
          }
        }
      }
    });
}
```

**`src/commands/version-cmd.ts`:** Change only the signature and registration:
```typescript
// Change import
import type { Command } from "commander";

// Change registration function (at the bottom of the file)
export function registerVersionCommand(parent: Command): void {
  parent
    .command("version")
    .description("Consume changesets and bump versions")
    .option("--dry-run", "Show changes without writing")
    .action(async (options: { dryRun?: boolean }) => {
      await runVersionCommand(process.cwd(), { dryRun: options.dryRun });
    });
}
```

**`src/commands/pre.ts`:**
```typescript
import type { Command } from "commander";
import { enterPreMode, exitPreMode } from "../prerelease/pre.js";

export function registerPreCommand(parent: Command): void {
  parent
    .command("pre")
    .description("Manage pre-release mode")
    .argument("<action>", '"enter" or "exit"')
    .argument("[tag]", "Pre-release tag (required for enter)")
    .action(async (action: string, tag?: string) => {
      if (action === "enter") {
        if (!tag) {
          console.error("Usage: pubm changesets pre enter <tag>");
          process.exit(1);
        }
        enterPreMode(tag);
        console.log(`Entered pre-release mode (${tag})`);
      } else if (action === "exit") {
        exitPreMode();
        console.log("Exited pre-release mode");
      } else {
        console.error(`Unknown pre action: ${action}. Use "enter" or "exit".`);
        process.exit(1);
      }
    });
}
```

**`src/commands/snapshot.ts`:** Change `import type { CAC }` → `import type { Command }` and `(cli: CAC)` → `(parent: Command)`, change `cli.command(...)` → `parent.command(...)`. Use `.argument("[tag]")` and `.description(...)` separately.

**`src/commands/migrate.ts`:**
```typescript
import type { Command } from "commander";
import { migrateFromChangesets } from "../changeset/migrate.js";

export function registerMigrateCommand(parent: Command): void {
  parent
    .command("migrate")
    .description("Migrate from .changeset/ to .pubm/")
    .action(async () => {
      const result = migrateFromChangesets();

      if (!result.success) {
        console.error(result.error);
        process.exit(1);
      }

      console.log(`Migrated ${result.migratedFiles.length} changeset files.`);
      if (result.configMigrated) {
        console.log(
          "Note: .changeset/config.json detected. Please manually create pubm.config.ts.",
        );
      }
    });
}
```

**Step 3: Verify typecheck**

Run: `bun run typecheck`
Expected: Pass

**Step 4: Commit**

```bash
git add src/commands/ src/cli.ts
git commit -m "feat: migrate CLI from CAC to Commander.js, group changesets under subcommand"
```

---

### Task 4: Migrate remaining top-level commands

**Files:**
- Modify: `src/commands/init.ts`
- Modify: `src/commands/update.ts`
- Modify: `src/commands/secrets.ts`
- Modify: `src/commands/sync.ts`

**Step 1: Update each file**

Same pattern: `CAC` → `Command`, `cli` → `parent`, `.command("name", "desc")` → `.command("name").description("desc")`.

**`src/commands/init.ts`:**
```typescript
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Command } from "commander";

export function registerInitCommand(parent: Command): void {
  parent
    .command("init")
    .description("Initialize pubm configuration")
    .action(async () => {
      const pubmDir = path.resolve(".pubm", "changesets");
      if (!existsSync(pubmDir)) {
        mkdirSync(pubmDir, { recursive: true });
        console.log("Created .pubm/changesets/");
      }

      const configPath = path.resolve("pubm.config.ts");
      if (!existsSync(configPath)) {
        writeFileSync(
          configPath,
          [
            "import { defineConfig } from 'pubm'",
            "",
            "export default defineConfig({})",
            "",
          ].join("\n"),
        );
        console.log("Created pubm.config.ts");
      }

      console.log("pubm initialized successfully.");
    });
}
```

**`src/commands/update.ts`:**
```typescript
import type { Command } from "commander";
import { UpdateKit } from "update-kit";

export function registerUpdateCommand(parent: Command): void {
  parent
    .command("update")
    .description("Update pubm to the latest version")
    .action(async (): Promise<void> => {
      // ... (body unchanged)
    });
}
```

**`src/commands/secrets.ts`:**
```typescript
import type { Command } from "commander";
import { consoleError } from "../error.js";
import { syncGhSecrets } from "../tasks/preflight.js";
import { loadTokensFromDb } from "../utils/token.js";

export function registerSecretsCommand(parent: Command): void {
  const secrets = parent
    .command("secrets")
    .description("Manage secrets");

  secrets
    .command("sync")
    .description("Sync stored tokens to GitHub Secrets")
    .option("--registry <registries>", "Filter to specific registries")
    .action(async (options: { registry?: string }) => {
      // ... (body unchanged)
    });
}
```

**`src/commands/sync.ts`:** Same pattern change. The `discoverVersionReferences` function and its helpers stay unchanged — only the `registerSyncCommand` function signature and registration changes.

**Step 2: Verify typecheck and tests**

Run: `bun run typecheck && bun run test`
Expected: Typecheck passes. Tests will fail (cli.test.ts mocks CAC) — that's addressed in Task 5.

**Step 3: Commit**

```bash
git add src/commands/
git commit -m "refactor: migrate remaining commands from CAC to Commander.js"
```

---

### Task 5: Update CLI tests

**Files:**
- Modify: `tests/unit/cli.test.ts`

**Step 1: Rewrite CLI tests for Commander.js**

The existing tests mock CAC's fluent API. With Commander.js, we need a different mocking approach. Commander allows creating a `Command` instance and calling `.parseAsync()` with argv directly, which is more testable.

Strategy: Instead of mocking Commander's internals, mock the dependencies (`pubm`, `Git`, etc.) and invoke the program with test argv arrays.

Create a helper to build the program without the IIFE:

First, refactor `src/cli.ts` to export `createProgram()` so tests can call it directly:

```typescript
// Add this export to src/cli.ts
export function createProgram(): Command {
  const program = new Command("pubm");

  // Register subcommands
  registerChangesetsCommand(program);
  registerInitCommand(program);
  registerUpdateCommand(program);
  registerSecretsCommand(program);
  registerSyncCommand(program);

  // Default command setup (all the .option() and .action() calls)
  program
    .argument("[version]", ...)
    .option(...)
    ...
    .action(async (nextVersion, options) => { ... });

  return program;
}

// IIFE at bottom uses createProgram()
(async () => {
  const program = createProgram();
  program.version(await version({ cwd: import.meta.dirname }));
  await program.parseAsync();
})();
```

Then rewrite `tests/unit/cli.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock dependencies (same mocks as before for pubm, Git, etc.)
// But no CAC mock needed

const mockPubm = vi.fn();
const mockGitInstance = { latestTag: vi.fn() };
const mockConsoleError = vi.fn();
const mockRequiredMissingInformationTasks = vi.fn(() => ({ run: vi.fn() }));
const mockNotifyNewVersion = vi.fn();
const mockIsCI = { isCI: false };

vi.mock("../../src/index.js", () => ({ pubm: mockPubm }));
vi.mock("../../src/git.js", () => ({ Git: vi.fn(() => mockGitInstance) }));
vi.mock("../../src/error.js", () => ({
  consoleError: mockConsoleError,
  AbstractError: class extends Error {},
}));
vi.mock("../../src/tasks/required-missing-information.js", () => ({
  requiredMissingInformationTasks: mockRequiredMissingInformationTasks,
}));
vi.mock("../../src/utils/notify-new-version.js", () => ({
  notifyNewVersion: mockNotifyNewVersion,
}));
vi.mock("../../src/utils/package.js", () => ({
  version: vi.fn().mockResolvedValue("1.0.0"),
}));
vi.mock("std-env", () => mockIsCI);

// Mock all subcommand registrations to isolate default command tests
vi.mock("../../src/commands/changesets.js", () => ({
  registerChangesetsCommand: vi.fn(),
}));
vi.mock("../../src/commands/init.js", () => ({
  registerInitCommand: vi.fn(),
}));
vi.mock("../../src/commands/update.js", () => ({
  registerUpdateCommand: vi.fn(),
}));
vi.mock("../../src/commands/secrets.js", () => ({
  registerSecretsCommand: vi.fn(),
}));
vi.mock("../../src/commands/sync.js", () => ({
  registerSyncCommand: vi.fn(),
}));

import { createProgram } from "../../src/cli.js";

beforeEach(() => {
  vi.clearAllMocks();
  mockIsCI.isCI = false;
  vi.spyOn(console, "clear").mockImplementation(() => {});
  process.exitCode = undefined;
});

// Helper: parse argv through the program
async function run(...args: string[]) {
  const program = createProgram();
  program.exitOverride(); // Prevent process.exit on parse errors
  await program.parseAsync(["node", "pubm", ...args]);
}

describe("resolveCliOptions (tested through CLI action)", () => {
  it("should map --no-publish to skipPublish=true", async () => {
    await run("1.0.0", "--no-publish");
    expect(mockPubm).toHaveBeenCalledWith(
      expect.objectContaining({ skipPublish: true }),
    );
  });

  it("should map --no-tests to skipTests=true", async () => {
    await run("1.0.0", "--no-tests");
    expect(mockPubm).toHaveBeenCalledWith(
      expect.objectContaining({ skipTests: true }),
    );
  });

  // ... similar tests for --no-build, --no-release-draft, --no-pre-check, --no-condition-check
  // ... registry splitting test: --registry "npm,jsr,https://custom"
});

describe("CLI action handler - non-CI mode", () => {
  it("should call notifyNewVersion when not in CI", async () => {
    await run("1.0.0");
    expect(mockNotifyNewVersion).toHaveBeenCalledOnce();
  });

  // ... other non-CI tests
});

describe("CLI action handler - CI mode", () => {
  it("should get version from latest git tag when --publish-only", async () => {
    mockIsCI.isCI = true;
    mockGitInstance.latestTag.mockResolvedValue("v2.0.0");
    await run("--publish-only");
    expect(mockPubm).toHaveBeenCalledWith(
      expect.objectContaining({ version: "2.0.0" }),
    );
  });

  // ... other CI tests
});
```

**Step 2: Run tests**

Run: `bun run test`
Expected: All tests pass

**Step 3: Commit**

```bash
git add src/cli.ts tests/unit/cli.test.ts
git commit -m "test: rewrite CLI tests for Commander.js"
```

---

### Task 6: Final verification

**Step 1: Format**

Run: `bun run format`

**Step 2: Typecheck**

Run: `bun run typecheck`
Expected: Pass

**Step 3: All tests**

Run: `bun run test`
Expected: All pass

**Step 4: Build**

Run: `bun run build`
Expected: Build succeeds, `bin/cli.js` works

**Step 5: Smoke test**

Run:
```bash
node bin/cli.js --help
node bin/cli.js changesets --help
node bin/cli.js changesets add --help
```

Expected:
- `--help` shows publish options with version argument
- `changesets --help` lists all 6 subcommands
- `changesets add --help` shows add-specific options

**Step 6: Commit if any format fixes**

```bash
git add -A
git commit -m "chore: format fixes after Commander.js migration"
```
