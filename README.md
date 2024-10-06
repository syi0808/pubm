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

- Show New files and New dependencies
- Check commits exist since last release
- Check first time publish package
- if first time -> Check package name availabliity
- Input SemVer version
- Input tag (if version is prerelease)
<!-- - Check hasn't been published scoped package -->
- Required conditions checks (concurrently)
  - Check test and build scripts exists
  - Check package manager version and set pacakge manager on context
  - if not first time -> Verify user is authenticated
  - Validate version
  - Check for prerelease vesion
    - if not private and is prerelease version and tag option not exist -> throw error should set tag
  - Check git version
  - Check git remote
  - Check git tag existence
  - Check current branch is release branch
  - Check local working tree is clean
  - Check remote history is clean
- Cleanup
- Install dependencies
- Tests
- Build
- Bumping version
- Publish (concurrently)
  - npm 
    - run publish
    - two-factor authentication
  - jsr
    - run publish
    - two-factor authentication
- Push tags 
- Release draft
