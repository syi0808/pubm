# Changelog

## 0.4.4

### Patch Changes

- fix dry-run publish using stale version from restored manifest
- Replace --preview, --preflight, --ci, --publish-only with unified --mode/--phase/--dry-run system. Add --release-draft for draft GitHub Releases and unify release creation via GitHub API across all modes.
- Add three-choice changeset consumption prompt; packages with unchanged versions are now excluded from the publish pipeline
- Support both package name and path as changeset identifiers
- Add excludeRelease config option to skip git tags and GitHub releases for matched packages

