# pubm Plugin Installation

Use this file when your coding agent cannot install plugins from a marketplace.

## Download the plugin bundle

The deployed plugin bundle lives under the website's `/plugins/pubm-plugin/` path.

Download these files and directories together:

- `.claude-plugin/plugin.json`
- `skills/publish-setup/`
- `skills/publish-preview/`
- `skills/publish/`
- `skills/version-sync/`
- `skills/create-plugin/`

Keep the directory structure unchanged.

## Why it exists

Some coding agents support marketplace installation. Others only support:

- downloading a plugin bundle directly
- loading local skill directories
- importing checked-in prompt assets from a repository

This bundle exists so those agents can use the same checked-in `pubm` workflow without a marketplace.

## Bundle Contents

- `publish-setup`: sets up `pubm`, config, registries, CI, and changesets
- `publish-preview`: inspects the release plan before publishing
- `publish`: runs the guarded publish flow
- `version-sync`: helps wire non-manifest version references
- `create-plugin`: scaffolds a new `pubm` plugin package

## Installation Steps

1. download the `pubm-plugin` bundle from the deployed `/plugins/pubm-plugin/` path
2. place the files into the location your coding agent uses for local plugins, skills, or prompt bundles
3. preserve the folder layout so the manifest and skill files remain together
4. start with `publish-setup`

## Usage notes

- Treat the checked-in skill bundle as the source of truth for release work.
- Let the skills drive `pubm` commands instead of replacing them.
- Check changesets and repository state before publishing.
- Use preview and validation flows before irreversible actions.
