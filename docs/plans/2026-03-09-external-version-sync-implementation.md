# External Version Sync Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create a pubm plugin factory that synchronizes version references across non-package files, plus a discover command and Claude Code skill.

**Architecture:** `externalVersionSync()` returns a `PubmPlugin` with an `afterVersion` hook that updates JSON fields and regex patterns in configured target files. The `afterVersion` hook must fire BEFORE git commit so changes are included in the version bump commit. A `pubm sync --discover` command scans the project for version references. A Claude Code skill guides users through setup.

**Tech Stack:** TypeScript, pnpm, Vitest, Biome, CAC (CLI)

---

### Task 1: Move afterVersion Hook Before Git Commit

Currently `afterVersion` fires after git commit + tag (runner.ts:325). For plugins to modify files that get included in the version bump commit, the hook must fire between `replaceVersion` and `git.commit`.

**Files:**
- Modify: `src/tasks/runner.ts:306-325`

**Step 1: Read the current code**

Read `src/tasks/runner.ts` lines 260-335 to understand the version bump task structure.

**Step 2: Move the afterVersion hook**

In `src/tasks/runner.ts`, move `afterVersion` hook from after tag creation (line 325) to between file staging and git commit. The new order should be:

```ts
// 1. Replace version in manifest files
await git.reset();
const replaced = await replaceVersion(ctx.version, ctx.packages);
for (const replacedFile of replaced) {
  await git.stage(replacedFile);
}

// 2. Run afterVersion hook (plugins can modify + stage additional files)
await ctx.pluginRunner.runHook("afterVersion", ctx);

// 3. Commit and tag
const nextVersion = `v${ctx.version}`;
const commit = await git.commit(nextVersion);
commited = true;

task.output = "Creating tag...";
await git.createTag(nextVersion, commit);
tagCreated = true;
```

**Step 3: Run tests**

Run: `pnpm vitest --run tests/unit/tasks/runner.test.ts`
Expected: All existing tests pass (hook order change is transparent to tests)

**Step 4: Commit**

```bash
git add src/tasks/runner.ts
git commit -m "refactor: move afterVersion hook before git commit for plugin file inclusion"
```

---

### Task 2: Version Sync Target Types

**Files:**
- Create: `src/plugins/external-version-sync/types.ts`

**Step 1: Write the failing test**

Create `tests/unit/plugins/external-version-sync/types.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type {
  JsonTarget,
  RegexTarget,
  SyncTarget,
  ExternalVersionSyncOptions,
} from "../../../../src/plugins/external-version-sync/types.js";

describe("ExternalVersionSync types", () => {
  it("should accept a JSON target", () => {
    const target: JsonTarget = {
      file: "plugin.json",
      jsonPath: "version",
    };
    expect(target.file).toBe("plugin.json");
  });

  it("should accept a regex target", () => {
    const target: RegexTarget = {
      file: "README.md",
      pattern: /pubm@[\d.]+/g,
    };
    expect(target.pattern).toBeInstanceOf(RegExp);
  });

  it("should accept mixed targets in options", () => {
    const options: ExternalVersionSyncOptions = {
      targets: [
        { file: "plugin.json", jsonPath: "version" },
        { file: "README.md", pattern: /pubm@[\d.]+/g },
      ],
    };
    expect(options.targets).toHaveLength(2);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest --run tests/unit/plugins/external-version-sync/types.test.ts`
Expected: FAIL — module not found

**Step 3: Create the types**

Create `src/plugins/external-version-sync/types.ts`:

```ts
export interface JsonTarget {
  file: string;
  jsonPath: string;
}

export interface RegexTarget {
  file: string;
  pattern: RegExp;
}

export type SyncTarget = JsonTarget | RegexTarget;

export interface ExternalVersionSyncOptions {
  targets: SyncTarget[];
}

export function isJsonTarget(target: SyncTarget): target is JsonTarget {
  return "jsonPath" in target;
}

export function isRegexTarget(target: SyncTarget): target is RegexTarget {
  return "pattern" in target;
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm vitest --run tests/unit/plugins/external-version-sync/types.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/plugins/external-version-sync/types.ts tests/unit/plugins/external-version-sync/types.test.ts
git commit -m "feat: add ExternalVersionSync target type definitions"
```

---

### Task 3: Version Sync Core Logic

**Files:**
- Create: `src/plugins/external-version-sync/sync.ts`

**Step 1: Write the failing test**

Create `tests/unit/plugins/external-version-sync/sync.test.ts`:

```ts
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { syncVersionInFile } from "../../../../src/plugins/external-version-sync/sync.js";

describe("syncVersionInFile", () => {
  const tmpDir = path.join(import.meta.dirname, ".tmp-sync-test");

  beforeEach(() => {
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should update JSON file at jsonPath", () => {
    const filePath = path.join(tmpDir, "plugin.json");
    writeFileSync(filePath, JSON.stringify({ name: "test", version: "0.1.0" }, null, 2));

    const changed = syncVersionInFile(filePath, "1.0.0", { file: "plugin.json", jsonPath: "version" });

    expect(changed).toBe(true);
    const result = JSON.parse(readFileSync(filePath, "utf-8"));
    expect(result.version).toBe("1.0.0");
  });

  it("should update nested JSON path", () => {
    const filePath = path.join(tmpDir, "meta.json");
    writeFileSync(filePath, JSON.stringify({ metadata: { version: "0.1.0" } }, null, 2));

    const changed = syncVersionInFile(filePath, "2.0.0", { file: "meta.json", jsonPath: "metadata.version" });

    expect(changed).toBe(true);
    const result = JSON.parse(readFileSync(filePath, "utf-8"));
    expect(result.metadata.version).toBe("2.0.0");
  });

  it("should update text file with regex pattern", () => {
    const filePath = path.join(tmpDir, "README.md");
    writeFileSync(filePath, "Install: npm install pubm@0.2.12\nDone.");

    const changed = syncVersionInFile(filePath, "1.0.0", { file: "README.md", pattern: /pubm@[\d.]+/g });

    expect(changed).toBe(true);
    const result = readFileSync(filePath, "utf-8");
    expect(result).toBe("Install: npm install pubm@1.0.0\nDone.");
  });

  it("should return false when no changes needed", () => {
    const filePath = path.join(tmpDir, "data.json");
    writeFileSync(filePath, JSON.stringify({ version: "1.0.0" }, null, 2));

    const changed = syncVersionInFile(filePath, "1.0.0", { file: "data.json", jsonPath: "version" });

    expect(changed).toBe(false);
  });

  it("should handle regex with version prefix", () => {
    const filePath = path.join(tmpDir, "ci.yaml");
    writeFileSync(filePath, "uses: my-action@v0.2.12\n");

    const changed = syncVersionInFile(filePath, "1.0.0", { file: "ci.yaml", pattern: /my-action@v[\d.]+/g });

    expect(changed).toBe(true);
    const result = readFileSync(filePath, "utf-8");
    expect(result).toBe("uses: my-action@v1.0.0\n");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest --run tests/unit/plugins/external-version-sync/sync.test.ts`
Expected: FAIL — module not found

**Step 3: Implement sync logic**

Create `src/plugins/external-version-sync/sync.ts`:

```ts
import { readFileSync, writeFileSync } from "node:fs";
import type { SyncTarget } from "./types.js";
import { isJsonTarget } from "./types.js";

function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split(".");
  let current: Record<string, unknown> = obj;

  for (let i = 0; i < keys.length - 1; i++) {
    current = current[keys[i]] as Record<string, unknown>;
  }

  current[keys[keys.length - 1]] = value;
}

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const keys = path.split(".");
  let current: unknown = obj;

  for (const key of keys) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }

  return current;
}

export function syncVersionInFile(
  filePath: string,
  newVersion: string,
  target: SyncTarget,
): boolean {
  if (isJsonTarget(target)) {
    const content = readFileSync(filePath, "utf-8");
    const json = JSON.parse(content) as Record<string, unknown>;
    const currentValue = getNestedValue(json, target.jsonPath);

    if (currentValue === newVersion) {
      return false;
    }

    setNestedValue(json, target.jsonPath, newVersion);

    // Preserve original indentation
    const indent = content.match(/^\s+/m)?.[0] ?? "  ";
    writeFileSync(filePath, `${JSON.stringify(json, null, indent)}\n`, "utf-8");
    return true;
  }

  // Regex target
  const content = readFileSync(filePath, "utf-8");
  const pattern = new RegExp(target.pattern.source, target.pattern.flags);

  // Replace the version portion in each match
  const updated = content.replace(pattern, (match) => {
    // Find the version number in the match and replace it
    return match.replace(/\d+\.\d+\.\d+(?:-[\w.]+)?/, newVersion);
  });

  if (updated === content) {
    return false;
  }

  writeFileSync(filePath, updated, "utf-8");
  return true;
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm vitest --run tests/unit/plugins/external-version-sync/sync.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/plugins/external-version-sync/sync.ts tests/unit/plugins/external-version-sync/sync.test.ts
git commit -m "feat: add syncVersionInFile for JSON and regex targets"
```

---

### Task 4: Plugin Factory Function

**Files:**
- Create: `src/plugins/external-version-sync/index.ts`

**Step 1: Write the failing test**

Create `tests/unit/plugins/external-version-sync/plugin.test.ts`:

```ts
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { externalVersionSync } from "../../../../src/plugins/external-version-sync/index.js";

describe("externalVersionSync plugin factory", () => {
  const tmpDir = path.join(import.meta.dirname, ".tmp-plugin-test");

  beforeEach(() => {
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should return a PubmPlugin with correct name", () => {
    const plugin = externalVersionSync({ targets: [] });
    expect(plugin.name).toBe("external-version-sync");
  });

  it("should have an afterVersion hook", () => {
    const plugin = externalVersionSync({ targets: [] });
    expect(plugin.hooks?.afterVersion).toBeTypeOf("function");
  });

  it("should sync files in afterVersion hook", async () => {
    const jsonFile = path.join(tmpDir, "plugin.json");
    writeFileSync(jsonFile, JSON.stringify({ version: "0.1.0" }, null, 2));

    const plugin = externalVersionSync({
      targets: [{ file: jsonFile, jsonPath: "version" }],
    });

    // Simulate ctx with version
    const ctx = { version: "1.0.0" } as any;
    await plugin.hooks!.afterVersion!(ctx);

    const result = JSON.parse(readFileSync(jsonFile, "utf-8"));
    expect(result.version).toBe("1.0.0");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest --run tests/unit/plugins/external-version-sync/plugin.test.ts`
Expected: FAIL — module not found

**Step 3: Implement the plugin factory**

Create `src/plugins/external-version-sync/index.ts`:

```ts
import path from "node:path";
import process from "node:process";
import type { PubmPlugin } from "../../plugin/types.js";
import { syncVersionInFile } from "./sync.js";
import type { ExternalVersionSyncOptions } from "./types.js";

export { type ExternalVersionSyncOptions, type JsonTarget, type RegexTarget, type SyncTarget } from "./types.js";

export function externalVersionSync(options: ExternalVersionSyncOptions): PubmPlugin {
  return {
    name: "external-version-sync",
    hooks: {
      afterVersion: async (ctx) => {
        const cwd = process.cwd();

        for (const target of options.targets) {
          const filePath = path.isAbsolute(target.file)
            ? target.file
            : path.resolve(cwd, target.file);

          const changed = syncVersionInFile(filePath, ctx.version, target);

          if (changed) {
            console.log(`  Synced version in ${target.file}`);
          }
        }
      },
    },
  };
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm vitest --run tests/unit/plugins/external-version-sync/plugin.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/plugins/external-version-sync/index.ts tests/unit/plugins/external-version-sync/plugin.test.ts
git commit -m "feat: add externalVersionSync() plugin factory"
```

---

### Task 5: Export Plugin from Public API

**Files:**
- Modify: `src/index.ts`

**Step 1: Add exports**

Add to `src/index.ts`:

```ts
// External version sync plugin
export { externalVersionSync } from "./plugins/external-version-sync/index.js";
export type {
  ExternalVersionSyncOptions,
  JsonTarget,
  RegexTarget,
  SyncTarget,
} from "./plugins/external-version-sync/index.js";
```

**Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

**Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: export externalVersionSync from public API"
```

---

### Task 6: Discover Command

**Files:**
- Create: `src/commands/sync.ts`
- Modify: `src/cli.ts` — register the command

**Step 1: Write the failing test**

Create `tests/unit/commands/sync.test.ts`:

```ts
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discoverVersionReferences } from "../../../../src/commands/sync.js";

describe("discoverVersionReferences", () => {
  const tmpDir = path.join(import.meta.dirname, ".tmp-discover-test");

  beforeEach(() => {
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should find version in JSON files", () => {
    writeFileSync(
      path.join(tmpDir, "plugin.json"),
      JSON.stringify({ name: "test", version: "1.2.3" }, null, 2),
    );
    writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ name: "my-pkg", version: "1.2.3" }, null, 2),
    );

    const results = discoverVersionReferences(tmpDir, "1.2.3");

    // Should find plugin.json but NOT package.json (excluded)
    expect(results.some((r) => r.file === "plugin.json")).toBe(true);
    expect(results.some((r) => r.file === "package.json")).toBe(false);
  });

  it("should find version patterns in text files", () => {
    writeFileSync(
      path.join(tmpDir, "README.md"),
      "Install: npm install my-pkg@1.2.3\n",
    );

    const results = discoverVersionReferences(tmpDir, "1.2.3");

    expect(results.some((r) => r.file === "README.md")).toBe(true);
  });

  it("should exclude common directories", () => {
    mkdirSync(path.join(tmpDir, "node_modules", "pkg"), { recursive: true });
    writeFileSync(
      path.join(tmpDir, "node_modules", "pkg", "package.json"),
      JSON.stringify({ version: "1.2.3" }, null, 2),
    );

    const results = discoverVersionReferences(tmpDir, "1.2.3");
    expect(results).toHaveLength(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest --run tests/unit/commands/sync.test.ts`
Expected: FAIL — module not found

**Step 3: Implement discover logic**

Create `src/commands/sync.ts`:

```ts
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import type { CAC } from "cac";
import { getPackageJson, version } from "../utils/package.js";

export interface DiscoveredReference {
  file: string;
  type: "json" | "pattern";
  jsonPath?: string;
  match?: string;
  line?: number;
}

const EXCLUDED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "coverage",
  ".pubm",
  ".worktrees",
  "target",
]);

const EXCLUDED_FILES = new Set([
  "package.json",
  "jsr.json",
  "Cargo.toml",
  "Cargo.lock",
  "pnpm-lock.yaml",
  "package-lock.json",
  "yarn.lock",
  "CHANGELOG.md",
]);

function walkDir(dir: string, cwd: string): string[] {
  const files: string[] = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") && entry.name !== ".claude-plugin") continue;

    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      files.push(...walkDir(path.join(dir, entry.name), cwd));
    } else {
      const relativePath = path.relative(cwd, path.join(dir, entry.name));
      const fileName = entry.name;
      if (EXCLUDED_FILES.has(fileName)) continue;
      files.push(relativePath);
    }
  }

  return files;
}

function findJsonVersionPaths(
  obj: unknown,
  currentPath: string[] = [],
): string[] {
  const paths: string[] = [];

  if (obj == null || typeof obj !== "object") return paths;

  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const newPath = [...currentPath, key];

    if (key === "version" && typeof value === "string") {
      paths.push(newPath.join("."));
    }

    if (typeof value === "object" && value !== null) {
      paths.push(...findJsonVersionPaths(value, newPath));
    }
  }

  return paths;
}

export function discoverVersionReferences(
  cwd: string,
  currentVersion: string,
): DiscoveredReference[] {
  const results: DiscoveredReference[] = [];
  const files = walkDir(cwd, cwd);

  for (const file of files) {
    const fullPath = path.join(cwd, file);

    try {
      const stat = statSync(fullPath);
      if (stat.size > 1024 * 1024) continue; // Skip files > 1MB
    } catch {
      continue;
    }

    const ext = path.extname(file).toLowerCase();

    // Check JSON files for "version" fields
    if (ext === ".json") {
      try {
        const content = readFileSync(fullPath, "utf-8");
        const json = JSON.parse(content);
        const versionPaths = findJsonVersionPaths(json);

        for (const jsonPath of versionPaths) {
          const keys = jsonPath.split(".");
          let val: unknown = json;
          for (const k of keys) {
            val = (val as Record<string, unknown>)?.[k];
          }
          if (val === currentVersion) {
            results.push({ file, type: "json", jsonPath });
          }
        }
      } catch {
        // Not valid JSON, skip
      }
      continue;
    }

    // Check text files for version patterns
    try {
      const content = readFileSync(fullPath, "utf-8");
      // Skip binary-looking files
      if (content.includes("\0")) continue;

      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.includes(currentVersion)) {
          // Check common version reference patterns
          const patterns = [
            new RegExp(`@${currentVersion.replace(/\./g, "\\.")}`, "g"),
            new RegExp(`v${currentVersion.replace(/\./g, "\\.")}`, "g"),
            new RegExp(`"${currentVersion.replace(/\./g, "\\.")}"`, "g"),
            new RegExp(`'${currentVersion.replace(/\./g, "\\.")}'`, "g"),
          ];

          for (const pattern of patterns) {
            const match = line.match(pattern);
            if (match) {
              results.push({
                file,
                type: "pattern",
                match: match[0],
                line: i + 1,
              });
              break;
            }
          }
        }
      }
    } catch {
      // Can't read, skip
    }
  }

  return results;
}

function formatConfigSnippet(refs: DiscoveredReference[]): string {
  const targets: string[] = [];

  for (const ref of refs) {
    if (ref.type === "json" && ref.jsonPath) {
      targets.push(`  { file: "${ref.file}", jsonPath: "${ref.jsonPath}" },`);
    } else if (ref.type === "pattern" && ref.match) {
      // Construct a regex from the match pattern
      const escaped = ref.match.replace(/[\d.]+/, "[\\\\d.]+");
      targets.push(`  { file: "${ref.file}", pattern: /${escaped}/g },`);
    }
  }

  return `externalVersionSync({
  targets: [
${targets.join("\n")}
  ],
})`;
}

export function registerSyncCommand(cli: CAC): void {
  cli
    .command("sync", "Manage external version references")
    .option("--discover", "Scan project for version references", { type: Boolean })
    .action(async (options: { discover?: boolean }) => {
      if (!options.discover) {
        console.log("Usage: pubm sync --discover");
        console.log("Scans your project for version references outside package.json.");
        return;
      }

      const cwd = process.cwd();
      const currentVersion = await version({ cwd });

      console.log(`Scanning for version references (${currentVersion})...\n`);

      const refs = discoverVersionReferences(cwd, currentVersion);

      if (refs.length === 0) {
        console.log("No external version references found.");
        return;
      }

      console.log(`Found ${refs.length} reference(s):\n`);

      for (const ref of refs) {
        if (ref.type === "json") {
          console.log(`  ${ref.file} → ${ref.jsonPath}`);
        } else {
          console.log(`  ${ref.file}:${ref.line} → ${ref.match}`);
        }
      }

      console.log("\nAdd this to your pubm.config.ts plugins:\n");
      console.log(formatConfigSnippet(refs));
    });
}
```

**Step 4: Register in CLI**

In `src/cli.ts`, add:

```ts
import { registerSyncCommand } from "./commands/sync.js";
```

And add the registration call alongside other commands:

```ts
registerSyncCommand(cli);
```

**Step 5: Run tests and format**

Run: `pnpm vitest --run tests/unit/commands/sync.test.ts && pnpm format && pnpm typecheck`
Expected: PASS

**Step 6: Commit**

```bash
git add src/commands/sync.ts src/cli.ts tests/unit/commands/sync.test.ts
git commit -m "feat: add pubm sync --discover command for finding version references"
```

---

### Task 7: version-sync Claude Code Skill

**Files:**
- Create: `plugins/pubm-plugin/skills/version-sync/SKILL.md`

**Step 1: Create the skill file**

Create `plugins/pubm-plugin/skills/version-sync/SKILL.md`:

```markdown
---
name: version-sync
description: Set up external version synchronization for non-package version references
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
  - Glob
  - Grep
  - AskUserQuestion
---

# Set Up External Version Sync

Guide users through configuring automatic version synchronization for files outside package.json (docs, plugin metadata, CI configs, etc.).

## Workflow

### 1. Discover Version References

Run `pubm sync --discover` to scan the project for external version references.

This finds:
- JSON files with `"version"` fields matching the current package version
- Text files with version patterns like `@x.y.z`, `vx.y.z`
- Excludes: `package.json`, `jsr.json`, `Cargo.toml`, lock files, `node_modules`, `.git`, `dist`

### 2. Review Discovered References

Show the user the discovered references and ask which ones to include in automatic sync. Some references might be intentionally pinned to a different version.

### 3. Add Plugin to Config

Read the current `pubm.config.ts`. If it exists, add `externalVersionSync()` to the `plugins` array. If it doesn't exist, create one.

The import comes from `pubm`:
```typescript
import { defineConfig, externalVersionSync } from "pubm";
```

Example config with the plugin:
```typescript
import { defineConfig, externalVersionSync } from "pubm";

export default defineConfig({
  registries: ["npm", "jsr"],
  plugins: [
    externalVersionSync({
      targets: [
        { file: "plugins/.claude-plugin/plugin.json", jsonPath: "version" },
        { file: "README.md", pattern: /pubm@[\d.]+/g },
      ],
    }),
  ],
});
```

### 4. Add Custom Targets (Optional)

Ask if the user has additional files with version references that weren't auto-detected. Common examples:
- CI workflow files referencing action versions
- Documentation with install commands
- Plugin/extension metadata files
- Docker image tags

### 5. Test the Setup

Run `pubm version --dry-run` to verify the sync would work correctly. If no changesets exist, create a test changeset first with `pubm add`.

### 6. Present Summary

Confirm the setup is complete and explain:
- Version sync runs automatically during `pubm version` and the main publish pipeline
- Synced file changes are included in the version bump commit
- New references can be added to the `targets` array in config

## Constraints

- Always use `externalVersionSync()` from `pubm` import (not a relative path)
- Always use `defineConfig()` for type safety
- Do not modify `package.json`, `jsr.json`, or `Cargo.toml` targets — these are handled by pubm's core version replacement
- When editing existing config, preserve all existing settings and plugins
```

**Step 2: Commit**

```bash
git add plugins/pubm-plugin/skills/version-sync/SKILL.md
git commit -m "feat: add version-sync Claude Code skill"
```

---

### Task 8: Update publish-setup Skill (Step 10)

**Files:**
- Modify: `plugins/pubm-plugin/skills/publish-setup/SKILL.md`

**Step 1: Read the current skill**

Read `plugins/pubm-plugin/skills/publish-setup/SKILL.md` to understand the 9-step structure.

**Step 2: Add Step 10**

After the existing "### 9. Present summary" section, add:

```markdown
### 10. External Version Sync (Optional)

Ask if the project has version references outside of package manifest files (e.g., plugin metadata, docs, CI configs).

If yes:
1. Run `pubm sync --discover` to scan for references
2. Show discovered references and ask which to include
3. Add `externalVersionSync()` plugin to `pubm.config.ts`:

```typescript
import { defineConfig, externalVersionSync } from "pubm";

export default defineConfig({
  registries: ["npm", "jsr"],
  plugins: [
    externalVersionSync({
      targets: [
        // discovered targets here
      ],
    }),
  ],
});
```

If no, skip this step.
```

**Step 3: Commit**

```bash
git add plugins/pubm-plugin/skills/publish-setup/SKILL.md
git commit -m "feat: add external version sync step to publish-setup skill"
```

---

### Task 9: Update Plugin Marketplace Registration

**Files:**
- Modify: `plugins/pubm-plugin/.claude-plugin/plugin.json` — bump version
- Modify: `.claude-plugin/marketplace.json` — add version-sync to description

**Step 1: Update plugin.json**

Bump version and update description to mention the new skill.

**Step 2: Update marketplace.json**

Update the description to include `version-sync`:

```json
"description": "Publish packages to multiple registries (npm, jsr, crates.io) with pubm. Includes /publish, /publish-preview, /publish-setup, and /version-sync commands."
```

**Step 3: Commit**

```bash
git add plugins/pubm-plugin/.claude-plugin/plugin.json .claude-plugin/marketplace.json
git commit -m "chore: register version-sync skill in plugin marketplace"
```

---

### Task 10: Final Verification

**Step 1: Run format**

Run: `pnpm format`

**Step 2: Run typecheck**

Run: `pnpm typecheck`

**Step 3: Run all tests**

Run: `pnpm test`

**Step 4: Run build**

Run: `pnpm build`

**Step 5: Fix any issues and commit**

```bash
git add -A
git commit -m "chore: final formatting and fixes"
```
