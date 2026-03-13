# pubm Plugin Installation

This file explains how to obtain the `pubm plugin` bundle when your coding agent does not support a plugin marketplace.

## Give this link to the agent

When your coding agent can accept repository docs or setup links, give it the deployed `INSTALLATION.md` URL first.

That page tells the agent where the statically deployed plugin bundle lives under the website's `/plugins/pubm-plugin/` path.

The agent should fetch these files and directories together:

- `.claude-plugin/plugin.json`
- `skills/publish-setup/`
- `skills/publish-preview/`
- `skills/publish/`
- `skills/version-sync/`
- `skills/create-plugin/`

The directory structure must stay unchanged after download.

## Why this exists

Some coding agents support marketplace installation. Others only support:

- downloading a plugin bundle directly
- loading local skill directories
- importing checked-in prompt assets from a repository

This bundle is published so those agents can consume the same checked-in `pubm` workflow without depending on a marketplace.

## What the bundle contains

- `publish-setup`: sets up `pubm`, config, registries, CI, and changesets
- `publish-preview`: inspects the release plan before publishing
- `publish`: runs the guarded publish flow
- `version-sync`: helps wire non-manifest version references
- `create-plugin`: scaffolds a new `pubm` plugin package

## Installation model

1. provide the deployed `INSTALLATION.md` link to the coding agent
2. let the agent fetch the `pubm-plugin` bundle from the `/plugins/pubm-plugin/` path
3. place the files into the location your coding agent uses for local plugins, skills, or prompt bundles
4. preserve the folder layout so the manifest and skill files remain together
5. start with `publish-setup`

## Usage notes

- use the checked-in skill bundle as the source of truth for agent-driven release work
- let the skills orchestrate `pubm` commands instead of replacing them
- inspect changesets and repository state before publishing
- use preview and validation flows before irreversible actions
