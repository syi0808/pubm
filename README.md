<p align="center">
<img src="https://github.com/syi0808/pubm/blob/main/docs/logo.svg" height="150">
</p>

<h1 align="center">
pubm
</h1>

<p align="center">
publish manager for multiple registry (JSR, npm and private registries)
<p>

## Why

- Customize with plugin

It is designed to be easy to managing publish to multiple registry.

## Usage

```bash
pubm publish
```

## Config file for publish

You can have either package.json or jsr.json.


## Tasks

<details>
  <summary>
    np tasks
  </summary>

  - Show New files and New dependencies
  - Check commits exist since last release
  - Check package name availabliity
  - Input SemVer version
  - Input tag (if version is prerelease)
  - Check hasn't been published scoped package
  - Prerequisite tasks
    - Ping npm registry
    - Check package manager version
    - Verify user is authenticated
    - Check git version
    - Check git remote
    - Validate version
    - Check for prerelease vesion
      - if not private and is prerelease version and tag option not exist -> throw error should set tag
    - Check git tag existence
  - Git tasks
    - Check current branch is release branch
    - Check local working tree is clean
    - Check remote history is clean
  - Cleanup
  - Install dependencies
  - Tests
  - Bumping version
  - Publish package
  - two-factor authentication
  - Push tags
  - Release draft

</details>

- Notify new version

- Required missing information
  - Select SemVer increment or specify new version
  - Enter the tag for this pre-release version in npm: (if version is prerelease) 

- Prerequisite checks = skip-pre (for safety deploy)
  - Checking if remote history is clean...
  - Checking if the local working tree is clean…
  - Checking if commits exist since the last release...
  - Confirming new files and new dependencies...
      - compare and get add files using diff with HEAD and latest tag
      - get local package.json and latest tag package.json file
  - Checking if the package has never been deployed...
      - check npm registry
  - if first time -> Checking package name availability…

- Required conditions checks (concurrently) = skip-required (for pubm tasks)
  - Ping registries…
  - Checking if test and build scripts exist...
  - Checking package manager version...
  - if not first time -> Verifying user authentication...
  - Checking git version...
  - Checking git remote...
  - Checking git tag existence...
  - Verifying current branch is a release branch...
  - Checking if npm and jsr are installed...

- Running tests...
- Building the project...
- Bumping version…
- Publishing... (concurrently)
  - npm
      - Running npm publish…
      - Verifying two-factor authentication…
  - jsr
      - Running jsr publish…
      - Verifying two-factor authentication…
- Pushing tags to GitHub...
- Creating release draft on GitHub...