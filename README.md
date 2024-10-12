<p align="center">
<img src="https://github.com/syi0808/pubm/blob/main/docs/logo.svg" height="150">
</p>

<h1 align="center">
pubm
</h1>

<p align="center">
publish manager for multiple registry (jsr, npm and private registries)
<p>

<p align="center">
<img src="https://github.com/syi0808/pubm/blob/main/docs/demo.gif" width="100%">
</p>

## Features

- Publish package to npm and jsr at once
- Customize (Soon)
  - GitHub release draft format
  - Adjust tasks (Add, Remove, Sorting tasks)

## Prerequisites

- Node.js 18 or later
- npm 9 or later
- Git 2.11 or later

## Install

```bash
npm i -g pubm
```

## Usage

```bash
Usage:
  $ pubm [version]

  Version can be:
    major | premajor | minor | preminor | patch | prepatch | prerelease | 1.2.3

Options:
  --test-script <script>      The npm script to run tests before publishing (default: test)
  --build-script <script>     The npm script to run build before publishing (default: build)
  -p, --preview               Show tasks without actually executing publish 
  -b, --branch <name>         Name of the release branch (default: main)
  -a, --any-branch            Show tasks without actually executing publish 
  --no-pre-check              Skip prerequisites check task
  --no-condition-check        Skip required conditions check task
  --no-tests                  Skip running tests before publishing
  --no-build                  Skip build before publishing
  --no-publish                Skip publishing task
  --no-release-draft          Skip creating a GitHub release draft
  --publish-only              Run only publish task for latest tag 
  -t, --tag <name>            Publish under a specific dist-tag (default: latest)
  -c, --contents <path>       Subdirectory to publish 
  --no-save-token             Do not save jsr tokens (request the token each time)
  --registry <...registries>  Target registries for publish
        registry can be npm | jsr | https://url.for.private-registries (default: npm,jsr)
  -h, --help                  Display this message 
  -v, --version               Display version number 
```

## Config for publish

You can have either package.json or jsr.json.

### Configuration file (Soon)

`pubm.js` or `pubm.mjs`


## Tasks

<details>
<summary>
pubm tasks
</summary>

- Notify new version
- Checking required information
  - Select SemVer increment or specify new version
  - Select the tag for this pre-release version in npm: (if version is prerelease)
    - checking for the existence of either package.json or jsr.json
- Prerequisite checks = skip-pre (for deployment reliability)
  - Checking if remote history is clean...
  - Checking if the local working tree is clean...
  - Checking if commits exist since the last release...
  - Verifying current branch is a release branch...
  - Checking git tag existence...
- Required conditions checks (concurrently) = skip-required (for pubm tasks)
  - Verifying if npm CLI and jsr CLI are installed...
  - Ping registries...
  - Checking if test and build scripts exist...
  - Checking git version...
  - Checking available registries for publishing...
    - in jsr permission check token exist and ask token
    - if first time -> Checking package name availability...
    - if scoped package and scope reserved contact message
- Running tests...
- Building the project...
- Bumping version...
- Publishing... (concurrently)
  - npm
      - Running npm publish...
      - Verifying two-factor authentication...
  - jsr
      - Running jsr publish...
- Pushing tags to GitHub...
- Creating release draft on GitHub...
</details>

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

## FAQ

### Why does jsr only ask for tokens?

The only way to access jsr’s certified environment is through a direct API request with a token.

### How is the jsr token stored? Is it secure?

The jsr token is encrypted and stored using various layers of information. As long as you have control over the local machine where pubm was run, it is highly unlikely the token can be compromised.

If you prefer not to save tokens, you can use the `--no-save-token` option, which will request the token each time.