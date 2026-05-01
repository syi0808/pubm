# Troubleshooting

Common issues encountered during pubm setup and publishing, organized by category. Each entry lists the symptom, cause, and solution.

## Binary / Signing

### macOS binary killed immediately (SIGKILL)

**Symptom:** Binary exits silently with code 0, or `inspect packages` produces no output.

**Cause:** macOS Gatekeeper kills unsigned binaries with SIGKILL. The Node.js `cli.cjs` launcher swallows this signal as exit code 0, hiding the failure.

**Diagnosis:**
```bash
# Check if binary is signed
codesign -dv /path/to/binary

# Run binary directly (not through cli.cjs) to see the signal
./node_modules/@pubm/darwin-arm64/pubm
```

**Solution:**
```bash
codesign --remove-signature /path/to/binary
codesign -s - /path/to/binary
```

### Cross-compiled darwin binary fails

**Symptom:** Binary built on Linux for macOS (darwin) crashes or is killed on macOS.

**Cause:** Linux builds cannot produce ad-hoc signed macOS binaries. macOS requires code signatures even for ad-hoc (`-s -`) signing.

**Solution:** Build darwin binaries on a macOS runner. `rcodesign` was previously used for cross-platform signing but has been dropped in favor of native `codesign` on macOS runners.

```yaml
# CI: use macOS runner for darwin builds
jobs:
  build-darwin:
    runs-on: macos-latest
    steps:
      - run: |
          # Build binary...
          codesign --remove-signature $BINARY
          codesign -s - $BINARY
```

### `inspect packages` produces no output

**Symptom:** `pubm inspect packages` returns immediately with no output and no error.

**Cause:** The underlying binary is failing silently. Most commonly caused by unsigned macOS binaries (see above).

**Diagnosis:** Run the platform binary directly instead of through `cli.cjs`:
```bash
./node_modules/@pubm/darwin-arm64/pubm inspect packages
```

If it shows `Killed: 9`, the binary is unsigned.

## Ecosystem / Config

### Multi-ecosystem root shows empty name/version

**Symptom:** `pubm inspect packages` shows a package with empty name or version at the project root.

**Cause:** The root directory has both `Cargo.toml` and `package.json`. Rust is detected first (higher priority), and the Rust manifest may not have the expected name/version fields for your JS project.

**Solution:** Set the ecosystem explicitly in `pubm.config.ts`:
```typescript
import { defineConfig } from 'pubm';

export default defineConfig({
  packages: [
    {
      path: '.',
      ecosystem: 'js',
      registries: ['npm'],
    },
  ],
});
```

### `workspace:*` still in package.json after publish

**Symptom:** After publishing, `package.json` still shows `workspace:*` in dependencies.

**Cause:** This is expected behavior. pubm temporarily resolves `workspace:*` to concrete versions during the publish operation, then restores the original `workspace:*` references. The published package on the registry has concrete versions.

**Solution:** No action needed. Check the published package on the registry to confirm versions were resolved correctly.

## Git / CI

### "Version Packages" commit trigger not firing

**Symptom:** The CI workflow with `startsWith(github.event.head_commit.message, 'Version Packages')` never triggers.

**Cause:** Squash merges rewrite the commit message. The "Version Packages" commit message is lost.

**Solution:** Use **merge commit** or **fast-forward merge** strategy for the version PR. Do not use squash merge.

### `git push --follow-tags` rejected

**Symptom:** Push fails with a GitHub API error (GH006) about branch protection.

**Cause:** The target branch has push protection rules that prevent direct pushes.

**Solution:** pubm handles this automatically with a PR fallback. It creates a `pubm/version-packages-{timestamp}` branch, pushes there, and opens a PR via GitHub API. No manual action needed.

If you want to avoid the PR fallback, ensure the pushing user/token has bypass permissions on the branch protection rules.

### Direct Release in CI prompts for missing version

**Symptom:** `pubm` in CI fails because no version could be determined.

**Cause:** Bare `pubm` runs Direct Release. In CI it must receive an explicit version or derive one from configured version sources such as changesets or conventional commits.

**Solution:** Use the command shape that matches the workflow:
```bash
# For Publish prepared release after Prepare for CI publish has already versioned manifests
pubm --phase publish

# For Prepare for CI publish in Split CI Release
pubm --phase prepare

# For Direct Release in CI with an explicit version
pubm 1.2.3
```

### Tag already exists

**Symptom:** Version phase fails because a tag (e.g., `v1.2.3`) already exists.

**Cause:** A previous release attempt created the tag but failed before completing. Or the version was already released.

**Solution:**
- **Local:** pubm prompts whether to delete the existing tag
- **CI:** This is an error. Delete the tag manually before retrying:
  ```bash
  git tag -d v1.2.3
  git push origin :refs/tags/v1.2.3
  ```

### Changeset check failing on PRs

**Symptom:** The changeset check GitHub Action fails even though changes are user-facing.

**Cause:** No `.pubm/changesets/*.md` file was added to the PR.

**Solution:** Add a changeset:
```bash
pubm changesets add --packages <package-path> --bump <patch|minor|major> --message "description"
```

Or apply the `no-changeset` label to the PR if the change doesn't need a changeset (e.g., docs-only, CI config).

## Rollback

### What gets rolled back on failure

pubm registers rollback actions in LIFO (last-in, first-out) order. On failure:

1. Remote tags are deleted
2. Local commit is reverted
3. If PR fallback was used: PR is closed and branch is deleted
4. Local manifest backups are restored (versions, changelogs, changesets)

### Partial registry publish failure

**Symptom:** Publishing succeeded on some registries but failed on others.

**Cause:** Registry publishes run concurrently. If one fails after others succeed, the successful publishes cannot always be undone.

**Solution:** This requires manual intervention:
- **npm:** `npm unpublish` has a 72-hour window, but only for packages with no dependents
- **crates.io:** Published crates cannot be unpublished, only yanked (`cargo yank`)
- **jsr:** Check jsr.io for unpublish/deprecation options

Re-run Publish prepared release with `pubm --phase publish` after fixing the root cause — already-published versions are automatically skipped.
