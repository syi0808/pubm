# Packages Path Glob Pattern Support Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Support glob patterns in `packages[].path` so new packages are auto-discovered without config changes.

**Architecture:** Add an `isGlobPattern()` helper and change `discoverPackages()` to expand glob paths via the existing `resolvePatterns()` before resolving each target. No type or downstream changes needed.

**Tech Stack:** TypeScript, micromatch (already a dependency), vitest

---

## Chunk 1: Implementation and Tests

### Task 1: Add glob expansion tests

**Files:**
- Modify: `packages/core/tests/unit/monorepo/discover.test.ts`

- [ ] **Step 1: Write test — glob pattern expands to matched directories**

Add at end of the `describe("discoverPackages", ...)` block:

```typescript
it("expands glob pattern in configPackages path", async () => {
  const jsDescriptor = createMockEcosystemDescriptor("js", {
    name: "plugin",
    version: "1.0.0",
  });
  setupDirectoryEntries([
    "packages/plugins/plugin-a",
    "packages/plugins/plugin-b",
  ]);
  mockedEcosystemCatalog.detect.mockResolvedValue(jsDescriptor as any);
  mockedInferRegistries.mockResolvedValue(["npm"]);

  const result = await discoverPackages({
    cwd: "/project",
    configPackages: [{ path: "packages/plugins/*", registries: ["npm"] }],
  });

  expect(result).toHaveLength(2);
  const paths = result.map((r) => r.path);
  expect(paths).toContain(path.join("packages", "plugins", "plugin-a"));
  expect(paths).toContain(path.join("packages", "plugins", "plugin-b"));
});
```

- [ ] **Step 2: Write test — glob propagates options to all matched packages**

```typescript
it("propagates registries and ecosystem from glob config to all matched packages", async () => {
  const rustDescriptor = createMockEcosystemDescriptor("rust", {
    name: "crate",
    version: "0.1.0",
  });
  setupDirectoryEntries(["crates/crate-a", "crates/crate-b"]);
  mockedEcosystemCatalog.get.mockReturnValue(rustDescriptor as any);

  const result = await discoverPackages({
    cwd: "/project",
    configPackages: [
      { path: "crates/*", registries: ["crates"], ecosystem: "rust" },
    ],
  });

  expect(result).toHaveLength(2);
  for (const pkg of result) {
    expect(pkg.registries).toEqual(["crates"]);
    expect(pkg.ecosystem).toBe("rust");
  }
  // ecosystemCatalog.get should be used (not detect) since ecosystem is explicit
  expect(mockedEcosystemCatalog.detect).not.toHaveBeenCalled();
});
```

- [ ] **Step 3: Write test — glob filters out private packages**

```typescript
it("filters private packages matched by glob pattern", async () => {
  const publicDescriptor = createMockEcosystemDescriptor("js", {
    name: "public-plugin",
    version: "1.0.0",
    private: false,
  });
  const privateDescriptor = createMockEcosystemDescriptor("js", {
    name: "private-plugin",
    version: "1.0.0",
    private: true,
  });
  setupDirectoryEntries([
    "packages/plugins/public-plugin",
    "packages/plugins/private-plugin",
  ]);
  mockedEcosystemCatalog.detect.mockImplementation(
    async (pkgPath: string) => {
      if (String(pkgPath).includes("private-plugin")) {
        return privateDescriptor as any;
      }
      return publicDescriptor as any;
    },
  );
  mockedInferRegistries.mockResolvedValue(["npm"]);

  const result = await discoverPackages({
    cwd: "/project",
    configPackages: [{ path: "packages/plugins/*" }],
  });

  expect(result).toHaveLength(1);
  expect(result[0].name).toBe("public-plugin");
});
```

- [ ] **Step 4: Write test — mixed glob and explicit paths**

```typescript
it("handles mixed glob and explicit paths in configPackages", async () => {
  const jsDescriptor = createMockEcosystemDescriptor("js", {
    name: "pkg",
    version: "1.0.0",
  });
  setupDirectoryEntries(["packages/plugins/plugin-a"]);
  mockedEcosystemCatalog.detect.mockResolvedValue(jsDescriptor as any);
  mockedInferRegistries.mockResolvedValue(["npm"]);

  const result = await discoverPackages({
    cwd: "/project",
    configPackages: [
      { path: "packages/plugins/*", registries: ["npm", "jsr"] },
      { path: "packages/core", registries: ["npm"] },
    ],
  });

  expect(result).toHaveLength(2);
  const pluginPkg = result.find((r) =>
    r.path.includes(path.join("plugins", "plugin-a")),
  );
  const corePkg = result.find((r) => r.path === path.join("packages", "core"));
  expect(pluginPkg?.registries).toEqual(["npm", "jsr"]);
  expect(corePkg?.registries).toEqual(["npm"]);
});
```

- [ ] **Step 5: Write test — glob with no matches returns empty**

```typescript
it("returns empty array when glob pattern matches nothing", async () => {
  setupDirectoryEntries([]);

  const result = await discoverPackages({
    cwd: "/project",
    configPackages: [{ path: "nonexistent/*" }],
  });

  expect(result).toEqual([]);
});
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `cd packages/core && bun vitest --run tests/unit/monorepo/discover.test.ts`
Expected: 5 new tests FAIL (glob paths not expanded yet)

- [ ] **Step 7: Commit failing tests**

```bash
git add packages/core/tests/unit/monorepo/discover.test.ts
git commit -m "test: add failing tests for glob pattern support in configPackages path"
```

### Task 2: Implement glob expansion in discoverPackages

**Files:**
- Modify: `packages/core/src/monorepo/discover.ts`

- [ ] **Step 1: Add `isGlobPattern` helper**

Add after the `toForwardSlash` function (after line 34):

```typescript
function isGlobPattern(pattern: string): boolean {
  return micromatch.scan(pattern).isGlob;
}
```

- [ ] **Step 2: Change configPackages mapping from `.map()` to `.flatMap()` with glob expansion**

Replace the block at lines 170-174:

```typescript
// Before:
const targets: DiscoverTarget[] = configPackages.map((pkg) => ({
  path: path.normalize(pkg.path),
  ecosystem: pkg.ecosystem,
  registries: pkg.registries as RegistryType[] | undefined,
}));

// After:
const targets: DiscoverTarget[] = configPackages.flatMap((pkg) => {
  if (isGlobPattern(pkg.path)) {
    const resolved = resolvePatterns(cwd, [pkg.path]);
    return resolved.map((absPath) => ({
      path: path.relative(cwd, absPath),
      ecosystem: pkg.ecosystem,
      registries: pkg.registries as RegistryType[] | undefined,
    }));
  }
  return {
    path: path.normalize(pkg.path),
    ecosystem: pkg.ecosystem,
    registries: pkg.registries as RegistryType[] | undefined,
  };
});
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `cd packages/core && bun vitest --run tests/unit/monorepo/discover.test.ts`
Expected: ALL tests PASS

- [ ] **Step 4: Run full check suite**

Run: `bun run format && bun run typecheck && bun run test`
Expected: All pass

- [ ] **Step 5: Commit implementation**

```bash
git add packages/core/src/monorepo/discover.ts
git commit -m "feat: support glob patterns in packages[].path config"
```
