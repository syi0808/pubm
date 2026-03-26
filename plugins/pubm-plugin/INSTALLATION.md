# pubm Plugin Installation

> **Note:** Use this file for coding agents that do **not** support a plugin marketplace, such as Codex or custom agents. If you use **Claude Code**, install the pubm plugin from the Claude Code marketplace instead.

Use this file to get the `pubm plugin` bundle when your coding agent does not support a plugin marketplace.

## Give This Link to the Agent

If your coding agent can read repository docs or setup links, give it the deployed `INSTALLATION.md` URL first.

That page points to the deployed plugin bundle under the website's `/plugins/pubm-plugin/` path.

The agent should fetch these files and directories together:

- `.claude-plugin/plugin.json`
- `skills/publish-setup/`
- `skills/publish-preview/`
- `skills/publish/`
- `skills/version-sync/`
- `skills/create-plugin/`

Keep the directory structure unchanged.

## Why It Exists

Some coding agents support marketplace installation. Others only support:

- downloading a plugin bundle directly
- loading local skill directories
- importing checked-in prompt assets from a repository

This bundle lets those agents use the same checked-in `pubm` workflow without a marketplace.

## Bundle Contents

- `publish-setup`: sets up `pubm`, config, registries, CI, and changesets
- `publish-preview`: inspects the release plan before publishing
- `publish`: runs the guarded publish flow
- `version-sync`: helps wire non-manifest version references
- `create-plugin`: scaffolds a new `pubm` plugin package

## Installation Steps

1. provide the deployed `INSTALLATION.md` link to the coding agent
2. let the agent fetch the `pubm-plugin` bundle from the `/plugins/pubm-plugin/` path
3. place the files into the location your coding agent uses for local plugins, skills, or prompt bundles
4. preserve the folder layout so the manifest and skill files remain together
5. start with `publish-setup`

## Alternative: `pubm setup-skills`

If `pubm` is already installed in the project, skip the manual bundle download and run:

```bash
pubm setup-skills
```

This downloads the skill bundle from the pubm GitHub repository and installs it in the right directory for your agent, whether that is Claude Code, Codex CLI, or Gemini CLI. It is also available as the final step of `pubm init`.

## Usage notes

- Treat the checked-in skill bundle as the source of truth for release work.
- Let the skills orchestrate `pubm` commands instead of replacing them.
- Inspect changesets and repository state before publishing.
- Use preview and validation flows before irreversible actions.
