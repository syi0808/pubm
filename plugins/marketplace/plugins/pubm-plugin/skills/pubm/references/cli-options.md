# pubm CLI Options Reference

## Usage

```
pubm [version] [options]
```

**version** (positional, optional): A SemVer bump keyword or explicit version string.

Accepted values: `major` | `minor` | `patch` | `premajor` | `preminor` | `prepatch` | `prerelease` | `<explicit semver e.g. 1.2.3>`

If omitted, pubm prompts interactively (TTY) or errors in CI.

---

## CLI Flags

| Flag | Alias | Type | Default | Description |
|------|-------|------|---------|-------------|
| `--test-script <script>` | -- | String | `test` | npm script name to run tests before publishing |
| `--build-script <script>` | -- | String | `build` | npm script name to run build before publishing |
| `-p, --preview` | `-p` | Boolean | `false` | Dry-run mode: display task graph without executing |
| `-b, --branch <name>` | `-b` | String | `main` | Required branch name for release (HEAD must match) |
| `-a, --any-branch` | `-a` | Boolean | `false` | Allow publishing from any branch (bypass branch guard) |
| `--no-pre-check` | -- | Boolean | (negates `true`) | Skip prerequisites check (branch, remote, working tree) |
| `--no-condition-check` | -- | Boolean | (negates `true`) | Skip required conditions check (registry ping, login) |
| `--no-tests` | -- | Boolean | (negates `true`) | Skip running test script before publishing |
| `--no-build` | -- | Boolean | (negates `true`) | Skip running build script before publishing |
| `--no-publish` | -- | Boolean | (negates `true`) | Skip the actual publish step (version bump only) |
| `--no-release-draft` | -- | Boolean | (negates `true`) | Skip creating a GitHub release draft |
| `--publish-only` | -- | Boolean | `false` | Run only the publish task for the latest git tag |
| `-t, --tag <name>` | `-t` | String | `latest` | Dist-tag for the publish (e.g. `beta`, `next`, `canary`) |
| `-c, --contents <path>` | `-c` | String | (none) | Subdirectory to publish instead of repo root |
| `--no-save-token` | -- | Boolean | (negates `true`) | Do not persist JSR tokens on disk; prompt each run |
| `--registry <...registries>` | -- | String | `npm,jsr` | Comma-separated target registries: `npm`, `jsr`, `crates`, or a URL for private registries |

### Notes on `--no-*` flags

The `--no-*` flags negate their corresponding boolean (e.g. `--no-tests` sets `tests=false`). In `resolveCliOptions` (src/cli.ts), these are mapped to `skip*` fields in the Options interface:

- `--no-pre-check` -> `skipPrerequisitesCheck: true`
- `--no-condition-check` -> `skipConditionsCheck: true`
- `--no-tests` -> `skipTests: true`
- `--no-build` -> `skipBuild: true`
- `--no-publish` -> `skipPublish: true`
- `--no-release-draft` -> `skipReleaseDraft: true`

### Notes on `--registry`

The value is a comma-separated string that gets split into an array. Each entry can be:
- `npm` -- publishes to npmjs.com
- `jsr` -- publishes to jsr.io
- `crates` -- publishes to crates.io (Rust/Cargo)
- A full URL (e.g. `https://registry.mycorp.com`) for private npm registries

---

## Common Combinations

```bash
# Dry-run a patch release (preview mode)
pubm patch --preview

# Publish only to npm with a beta dist-tag
pubm minor --registry npm --tag beta

# Skip tests during publish
pubm patch --no-tests

# CI: publish already-tagged commit to all registries
pubm --publish-only --registry npm,jsr

# Version bump only, no actual publish
pubm patch --no-publish

# Publish from a non-main branch
pubm patch --any-branch

# Publish a subdirectory
pubm patch --contents dist

# Skip all pre-flight checks (branch, registry ping)
pubm patch --no-pre-check --no-condition-check
```

---

## Programmatic API (`Options` interface)

Source: `src/types/options.ts`

```typescript
type RegistryType = "npm" | "jsr" | "crates" | string;

interface Options {
  version: string;            // Required. SemVer bump or explicit version
  testScript?: string;        // Default: "test"
  buildScript?: string;       // Default: "build"
  preview?: boolean;          // Default: false
  branch?: string;            // Default: "main"
  anyBranch?: boolean;        // Default: false
  skipTests?: boolean;        // Default: false
  skipBuild?: boolean;        // Default: false
  skipPublish?: boolean;      // Default: false
  skipReleaseDraft?: boolean; // Default: false
  skipPrerequisitesCheck?: boolean; // Default: false
  skipConditionsCheck?: boolean;    // Default: false
  publishOnly?: boolean;      // Default: false
  tag?: string;               // Default: "latest"
  contents?: string;          // Default: undefined
  saveToken?: boolean;        // Default: true
  registries?: RegistryType[]; // Default: ["npm", "jsr"]
}

interface ResolvedOptions extends Options {
  testScript: string;
  buildScript: string;
  branch: string;
  tag: string;
  saveToken: boolean;
  registries: RegistryType[];
}
```

Usage:
```typescript
import { pubm } from "pubm";

await pubm({
  version: "patch",
  registries: ["npm"],
  tag: "beta",
  skipTests: true,
});
```

---

## Environment Variables

| Variable | Registry | Purpose |
|----------|----------|---------|
| `NODE_AUTH_TOKEN` | npm | Automation token for npm publish in CI |
| `JSR_TOKEN` | jsr | Auth token for JSR publish in CI |
| `CARGO_REGISTRY_TOKEN` | crates.io | Auth token for crates.io publish |

In CI (detected via `std-env.isCI`), pubm requires these tokens to be set as environment variables. If missing, the publish task will error with a descriptive message.

In interactive mode (TTY), pubm can prompt for tokens. JSR tokens are encrypted and persisted locally in `.pubm/` unless `--no-save-token` is passed.

---

## CI vs Interactive Behavior

- **CI detected** (`std-env.isCI` is true) or **stdin is not a TTY**: All prompts are disabled. Version and tokens must be provided via CLI args and env vars.
- **Interactive** (TTY): pubm prompts for missing version, tag, and tokens.
- In CI, only `--publish-only` mode is supported. Without it, pubm errors regardless of whether a version argument is provided.
- With `--publish-only` in CI, pubm reads the version from the latest git tag automatically.
