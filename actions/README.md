# pubm Actions

GitHub Actions for [pubm](https://github.com/syi0808/pubm).

## Changeset Check

Checks PRs for valid pubm changeset files.

### Usage

```yaml
name: Changeset Check

on:
  pull_request:
    types: [opened, synchronize, reopened, labeled, unlabeled]

permissions:
  contents: read
  pull-requests: write

jobs:
  changeset-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: syi0808/pubm/actions/changeset-check@v1
        with:
          skip-label: no-changeset
```

## Inputs

| Input | Description | Default |
|-------|-------------|---------|
| `skip-label` | PR label name that bypasses the changeset requirement | `no-changeset` |
| `comment` | Whether to post/update a PR comment with the result | `true` |
| `token` | GitHub token for posting comments | `${{ github.token }}` |
| `working-directory` | Root of the project (if not repo root) | `.` |

## Outputs

| Output | Description |
|--------|-------------|
| `status` | Result: `success`, `missing`, `invalid`, or `skipped` |
| `changeset-files` | Newline-separated list of detected changeset files |
| `errors` | JSON array of validation error strings |

## What Changeset Check Does

1. Finds new or modified changeset files in `.pubm/changesets/` by diffing against the base branch
2. Checks each changeset file for:
   - Valid YAML frontmatter
   - Allowed bump types (`patch`, `minor`, `major`)
   - A non-empty summary
   - Package paths that actually exist in the repo
3. Posts a comment on the PR with the result (disable with `comment: false`)
4. Fails the check if no changeset is found or if there are validation errors
5. Skips the check when the configured skip label is on the PR

## Release PR

Creates managed release PRs that include version file, changelog, changeset, and `afterVersion` hook changes. It supports `push`, `workflow_dispatch`, and `/pubm ...` slash-command reruns on release PR comments.

Release PRs are scope-based pending PRs. When more releasable changes land on the base branch before a release PR is merged, the action updates the existing release PR for that package or group instead of opening a duplicate for the new computed version. The default pubm branch template is versionless (`pubm/release/{scopeSlug}`); the PR title and body carry the current version.

```yaml
- uses: syi0808/pubm/actions/release-pr@v1
  with:
    token: ${{ secrets.GITHUB_TOKEN }}
    base-branch: main
```

Inputs:

| Input | Description | Default |
|-------|-------------|---------|
| `token` | GitHub token for PR creation and comments | `${{ github.token }}` |
| `working-directory` | Root of the pubm project | `.` |
| `base-branch` | Branch that release PRs target | repository default branch |

## Publish

Publishes only after a labeled pubm release PR is merged into the base branch. The action verifies the merged PR through release labels and pubm metadata markers, reconstructs the changed release scope from the merge push, creates tags on the merged commit, publishes that scope, and creates GitHub Releases.

```yaml
- uses: syi0808/pubm/actions/publish@v1
  with:
    token: ${{ secrets.GITHUB_TOKEN }}
    base-branch: main
  env:
    NODE_AUTH_TOKEN: ${{ secrets.NODE_AUTH_TOKEN }}
    JSR_TOKEN: ${{ secrets.JSR_TOKEN }}
    CARGO_REGISTRY_TOKEN: ${{ secrets.CARGO_REGISTRY_TOKEN }}
```

Inputs:

| Input | Description | Default |
|-------|-------------|---------|
| `token` | GitHub token used for PR guardrails, tag push, and GitHub Releases | `${{ github.token }}` |
| `working-directory` | Root of the pubm project | `.` |
| `base-branch` | Branch that receives merged release PRs | repository default branch |

## License

Apache-2.0
