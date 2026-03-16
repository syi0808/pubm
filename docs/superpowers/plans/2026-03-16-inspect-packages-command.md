# Inspect Packages Command Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `pubm inspect packages` command that shows detected packages, registries, ecosystem, and workspace info.

**Architecture:** Core exports a pure `inspectPackages()` function that maps `ResolvedPubmConfig` + `detectWorkspace()` into `InspectPackagesResult`. CLI registers an `inspect` subcommand group with `packages` subcommand that formats the result as text or JSON.

**Tech Stack:** TypeScript, Commander.js, vitest

---

## Chunk 1: Core `inspectPackages()` function

### Task 1: Core — Write failing tests for `inspectPackages()`

**Files:**
- Create: `packages/core/tests/unit/inspect.test.ts`

- [ ] **Step 1: Write tests**

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/monorepo/workspace.js", () => ({
  detectWorkspace: vi.fn(),
}));

import type { ResolvedPubmConfig } from "../../src/config/types.js";
import { inspectPackages } from "../../src/inspect.js";
import { detectWorkspace } from "../../src/monorepo/workspace.js";

const mockedDetectWorkspace = vi.mocked(detectWorkspace);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("inspectPackages", () => {
  it("returns single JS package with no workspace", () => {
    mockedDetectWorkspace.mockReturnValue([]);

    const config = {
      packages: [
        {
          name: "my-package",
          version: "1.0.0",
          path: ".",
          registries: ["npm"],
          dependencies: [],
        },
      ],
    } as unknown as ResolvedPubmConfig;

    const result = inspectPackages(config, "/project");

    expect(result).toEqual({
      ecosystem: "javascript",
      workspace: { type: "single", monorepo: false },
      packages: [
        {
          name: "my-package",
          version: "1.0.0",
          path: ".",
          registries: ["npm"],
        },
      ],
    });
  });

  it("returns monorepo with pnpm workspace", () => {
    mockedDetectWorkspace.mockReturnValue([
      { type: "pnpm", patterns: ["packages/*"] },
    ]);

    const config = {
      packages: [
        {
          name: "@pubm/core",
          version: "1.0.0",
          path: "packages/core",
          registries: ["npm", "jsr"],
          dependencies: [],
        },
        {
          name: "pubm",
          version: "1.0.0",
          path: "packages/pubm",
          registries: ["npm"],
          dependencies: ["@pubm/core"],
        },
      ],
    } as unknown as ResolvedPubmConfig;

    const result = inspectPackages(config, "/project");

    expect(result).toEqual({
      ecosystem: "javascript",
      workspace: { type: "pnpm", monorepo: true },
      packages: [
        {
          name: "@pubm/core",
          version: "1.0.0",
          path: "packages/core",
          registries: ["npm", "jsr"],
        },
        {
          name: "pubm",
          version: "1.0.0",
          path: "packages/pubm",
          registries: ["npm"],
        },
      ],
    });
  });

  it("returns rust ecosystem for crates registry", () => {
    mockedDetectWorkspace.mockReturnValue([]);

    const config = {
      packages: [
        {
          name: "my-crate",
          version: "0.1.0",
          path: ".",
          registries: ["crates"],
          dependencies: [],
        },
      ],
    } as unknown as ResolvedPubmConfig;

    const result = inspectPackages(config, "/project");

    expect(result.ecosystem).toBe("rust");
  });

  it("returns mixed ecosystem when both JS and Rust packages exist", () => {
    mockedDetectWorkspace.mockReturnValue([]);

    const config = {
      packages: [
        {
          name: "my-pkg",
          version: "1.0.0",
          path: "js",
          registries: ["npm"],
          dependencies: [],
        },
        {
          name: "my-crate",
          version: "0.1.0",
          path: "rust",
          registries: ["crates"],
          dependencies: [],
        },
      ],
    } as unknown as ResolvedPubmConfig;

    const result = inspectPackages(config, "/project");

    expect(result.ecosystem).toBe("javascript, rust");
  });

  it("returns empty packages when discoveryEmpty is true", () => {
    mockedDetectWorkspace.mockReturnValue([]);

    const config = {
      packages: [],
      discoveryEmpty: true,
    } as unknown as ResolvedPubmConfig;

    const result = inspectPackages(config, "/project");

    expect(result.packages).toEqual([]);
  });

  it("preserves custom registry URLs in registries", () => {
    mockedDetectWorkspace.mockReturnValue([]);

    const config = {
      packages: [
        {
          name: "my-pkg",
          version: "1.0.0",
          path: ".",
          registries: ["npm", "https://registry.example.com"],
          dependencies: [],
        },
      ],
    } as unknown as ResolvedPubmConfig;

    const result = inspectPackages(config, "/project");

    expect(result.packages[0].registries).toEqual([
      "npm",
      "https://registry.example.com",
    ]);
  });

  it("returns unknown ecosystem for custom-only registry", () => {
    mockedDetectWorkspace.mockReturnValue([]);

    const config = {
      packages: [
        {
          name: "my-pkg",
          version: "1.0.0",
          path: ".",
          registries: ["https://registry.example.com"],
          dependencies: [],
        },
      ],
    } as unknown as ResolvedPubmConfig;

    const result = inspectPackages(config, "/project");

    expect(result.ecosystem).toBe("unknown");
  });

  it("uses first workspace type when multiple detected", () => {
    mockedDetectWorkspace.mockReturnValue([
      { type: "pnpm", patterns: ["packages/*"] },
      { type: "cargo", patterns: ["crates/*"] },
    ]);

    const config = {
      packages: [
        {
          name: "my-pkg",
          version: "1.0.0",
          path: "packages/core",
          registries: ["npm"],
          dependencies: [],
        },
      ],
    } as unknown as ResolvedPubmConfig;

    const result = inspectPackages(config, "/project");

    expect(result.workspace.type).toBe("pnpm");
  });

  it("detects monorepo even with single package in workspace", () => {
    mockedDetectWorkspace.mockReturnValue([
      { type: "pnpm", patterns: ["packages/*"] },
    ]);

    const config = {
      packages: [
        {
          name: "only-pkg",
          version: "1.0.0",
          path: "packages/only",
          registries: ["npm"],
          dependencies: [],
        },
      ],
    } as unknown as ResolvedPubmConfig;

    const result = inspectPackages(config, "/project");

    expect(result.workspace.monorepo).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/core && bun vitest --run tests/unit/inspect.test.ts`
Expected: FAIL — `inspectPackages` not found (module doesn't exist yet)

### Task 2: Core — Implement `inspectPackages()`

**Files:**
- Create: `packages/core/src/inspect.ts`
- Modify: `packages/core/src/index.ts:82-97`

- [ ] **Step 3: Create `inspect.ts`**

```typescript
import type { ResolvedPubmConfig } from "./config/types.js";
import { detectWorkspace } from "./monorepo/workspace.js";

export interface InspectPackagesResult {
  ecosystem: string
  workspace: {
    type: string
    monorepo: boolean
  }
  packages: Array<{
    name: string
    version: string
    path: string
    registries: string[]
  }>
}

function inferEcosystem(registries: string[]): string {
  if (registries.some((r) => r === "npm" || r === "jsr")) return "javascript";
  if (registries.includes("crates")) return "rust";
  return "unknown";
}

export function inspectPackages(
  config: ResolvedPubmConfig,
  cwd: string,
): InspectPackagesResult {
  const workspaces = detectWorkspace(cwd);

  const ecosystems = new Set<string>();
  const packages = config.packages.map((pkg) => {
    ecosystems.add(inferEcosystem(pkg.registries));
    return {
      name: pkg.name,
      version: pkg.version,
      path: pkg.path,
      registries: [...pkg.registries],
    };
  });

  const ecosystemList = [...ecosystems].filter((e) => e !== "unknown");
  const ecosystem = ecosystemList.length > 0 ? ecosystemList.join(", ") : "unknown";

  return {
    ecosystem,
    workspace: {
      type: workspaces.length > 0 ? workspaces[0].type : "single",
      monorepo: workspaces.length > 0,
    },
    packages,
  };
}
```

- [ ] **Step 4: Add exports to `index.ts`**

In `packages/core/src/index.ts`, add after the monorepo exports block (after line 97):

```typescript
// Inspect
export { inspectPackages } from "./inspect.js";
export type { InspectPackagesResult } from "./inspect.js";
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/core && bun vitest --run tests/unit/inspect.test.ts`
Expected: All 7 tests PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/inspect.ts packages/core/src/index.ts packages/core/tests/unit/inspect.test.ts
git commit -m "feat(core): add inspectPackages() function"
```

---

## Chunk 2: CLI `inspect packages` command

### Task 3: CLI — Create inspect command

**Files:**
- Create: `packages/pubm/src/commands/inspect.ts`
- Modify: `packages/pubm/src/cli.ts:84-90`

- [ ] **Step 7: Create `inspect.ts` command file**

```typescript
import { consoleError, inspectPackages } from "@pubm/core";
import type { ResolvedPubmConfig } from "@pubm/core";
import type { Command } from "commander";

export function registerInspectCommand(
  parent: Command,
  getConfig: () => ResolvedPubmConfig,
): void {
  const inspect = parent
    .command("inspect")
    .description("Inspect project configuration");

  inspect
    .command("packages")
    .description("Show detected packages and registries")
    .option("--json", "Output as JSON")
    .action(async (options: { json?: boolean }) => {
      try {
        const config = getConfig();
        const result = inspectPackages(config, process.cwd());

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        console.log(`Ecosystem: ${result.ecosystem}`);

        const workspaceLabel = result.workspace.monorepo
          ? `${result.workspace.type} (monorepo)`
          : result.workspace.type;
        console.log(`Workspace: ${workspaceLabel}`);

        if (result.packages.length === 0) {
          console.log("\nNo publishable packages found.");
          return;
        }

        console.log("\nPackages:");
        for (const pkg of result.packages) {
          console.log(
            `  ${pkg.name} (${pkg.version}) → ${pkg.registries.join(", ")}`,
          );
        }
      } catch (e) {
        consoleError(e as Error);
        process.exitCode = 1;
      }
    });
}
```

- [ ] **Step 8: Register command in `cli.ts`**

In `packages/pubm/src/cli.ts`, add the import at the top with other command imports:

```typescript
import { registerInspectCommand } from "./commands/inspect.js";
```

Add registration at line 90 (after `registerVersionCommand`):

```typescript
  registerInspectCommand(program, () => resolvedConfig);
```

- [ ] **Step 9: Build and verify**

Run: `bun run build`
Expected: Build succeeds with no errors

- [ ] **Step 10: Commit**

```bash
git add packages/pubm/src/commands/inspect.ts packages/pubm/src/cli.ts
git commit -m "feat(cli): add inspect packages command"
```

### Task 4: Final verification

- [ ] **Step 11: Run full check suite**

```bash
bun run format
bun run typecheck
bun run test
```

Expected: All pass

- [ ] **Step 12: Fix any issues and commit**

If format/typecheck/test found issues, fix and commit:

```bash
git add -u
git commit -m "fix: address lint/type issues in inspect command"
```
