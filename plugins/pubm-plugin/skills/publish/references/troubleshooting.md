# Troubleshooting

## Common Issues

| Error / Symptom | Cause | Fix |
|---|---|---|
| `jsr: command not found` or jsr CLI missing | `jsr` package not installed | Install `jsr` as a devDependency using your package manager (e.g. `pnpm add -D jsr`) |
| "Not logged in" or 401/403 from registry | Missing authentication | Run `npm login` for npm; check `NODE_AUTH_TOKEN` env var in CI; for jsr, re-authenticate |
| "Permission denied" or 403 on publish | No publish permission | Check npm org/team permissions; verify the package name is available or you have access |
| "Version already published" or 409 | Version exists on registry | Bump to a new version; cannot republish an existing version |
| "Branch mismatch" | HEAD is not on the configured branch | Switch to the release branch, or use `--any-branch` flag |
| "Working tree not clean" | Uncommitted changes | Commit or stash changes before publishing |
| "Registry unreachable" or network errors | Network/VPN issue | Check internet connection, VPN, or proxy settings |
| "OTP required" | npm 2FA is enabled | Enter OTP interactively; in CI, use an automation token with 2FA disabled for writes |
| "Version must be set in the CI environment" | Running pubm in CI without `--publish-only` | Use `pubm --publish-only` in CI (this is the only supported CI mode) |
| "Cannot find the latest tag" | No git tags exist when using `--publish-only` | Ensure a `v*` tag exists; use `fetch-depth: 0` in CI checkout |

## Unknown Errors

Run `pubm [version] --preview` to isolate which pipeline stage fails. If the preview succeeds, the issue is likely in the actual publish step (authentication, permissions, or registry-side).
