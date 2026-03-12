# Path Portability Design

## Goal

Make the path-sensitive parts of the core package behave consistently across macOS, Linux, and Windows by relying on `node:path` semantics instead of string-format assumptions.

## Current Problems

The current Windows CI failure came from code paths that are correct on each platform, but tests and some path handling expectations implicitly assume POSIX-style separators:

- tests compare path suffixes like `packages/pubm/package.json`
- tests expect persisted files under `/tmp/.pubm/...`
- implementation and tests become coupled to slash direction instead of path structure

This makes otherwise-correct path construction look broken on Windows.

## Constraints

- Prefer built-in `node:path` behavior over custom normalization helpers.
- Keep the fix narrow and focused on the failing areas.
- Avoid adding platform-branching logic unless absolutely necessary.
- Preserve existing user-visible behavior.

## Approved Approach

### Use `node:path` as the source of truth

All filesystem paths in the affected code should be built with `path.join`, `path.resolve`, and related `node:path` APIs. The implementation should not care whether separators are `/` or `\`.

### Remove string-format coupling from tests

The failing tests should stop asserting raw POSIX suffixes for paths. Instead, they should:

- derive expected file paths with `node:path`
- inspect path structure via `path.dirname`, `path.basename`, or normalized path components when mocking filesystem calls

This keeps the implementation platform-neutral without introducing compatibility shims.

### Keep the runtime behavior simple

For `gh-secrets-sync-state`, the runtime code can remain a thin wrapper over `Db().path` plus the sync-hash filename. The fix is to make the contract path-structural and verified the same way on every OS.

For `required-missing-information`, dependency discovery should continue to read package manifests using native paths. The fix is to make the test doubles understand those native paths.

## File Changes

- Modify [`packages/core/tests/unit/tasks/required-missing-information.test.ts`](/Users/sung-yein/Workspace/open-source/pubm/.worktrees/codex-path-portability/packages/core/tests/unit/tasks/required-missing-information.test.ts) to stop relying on POSIX-only suffix matching.
- Modify [`packages/core/tests/unit/utils/gh-secrets-sync-state.test.ts`](/Users/sung-yein/Workspace/open-source/pubm/.worktrees/codex-path-portability/packages/core/tests/unit/utils/gh-secrets-sync-state.test.ts) to build expected paths with `node:path`.
- Keep runtime code changes minimal, and only touch implementation files if a path contract is still ambiguous after the tests are corrected.

## Validation

Before calling the work complete:

1. Run the targeted failing tests in `packages/core`.
2. Confirm the new assertions do not depend on slash direction.
3. Re-run the same targeted tests after implementation to ensure green behavior.

## Notes

This design intentionally prefers removing path-format assumptions over adding explicit multi-platform compatibility branches. The code should be simpler after the change, not more conditional.
