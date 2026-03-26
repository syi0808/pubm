# Changelog

## 0.4.9

### Patch Changes

- Add plugin credentials and checks interface — plugins can now declare required credentials and preflight checks
- overhaul rollback system: class-based RollbackTracker with per-action registration, LIFO execution, registry unpublish support, and removal of onRollback plugin hook
- Support deno.json and deno.jsonc as JSR manifest sources alongside jsr.json, with multi-file consistency validation, registry-driven inference, and Deno-only project detection

## 0.4.6

### Patch Changes

- Add lockfileSync config option and JS lockfile sync on version bump

## 0.4.5

### Patch Changes

- Fix ELOOP error caused by circular symlinks during workspace directory scanning

## 0.4.4

### Patch Changes

- fix dry-run publish using stale version from restored manifest
- Replace --preview, --preflight, --ci, --publish-only with unified --mode/--phase/--dry-run system. Add --release-draft for draft GitHub Releases and unify release creation via GitHub API across all modes.
- Add three-choice changeset consumption prompt; packages with unchanged versions are now excluded from the publish pipeline
- Support both package name and path as changeset identifiers
- Add excludeRelease config option to skip git tags and GitHub releases for matched packages

