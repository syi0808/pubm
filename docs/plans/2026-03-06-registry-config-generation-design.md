# Registry Config File Generation in Setup Skill

## Summary

Add a step to the `publish-setup` skill that detects missing registry config files and generates them from existing source files.

## Scope

Skill-level only (Approach A). No changes to pubm source code or CLI.

## Where It Fits

New step between current Step 3 (Ask which registries) and Step 4 (Generate config file) in `publish-setup.md`.

## Generation Rules

| Selected registry | Required file | Source file | Mapping |
|---|---|---|---|
| jsr | `jsr.json` | `package.json` | name, version, exports, publish.include/exclude |
| npm / custom URL | `package.json` | `jsr.json` | name, version, files, exports |
| crates | `Cargo.toml` | `package.json` | name (strip scope), version, description, license, authors, repository, edition=2021 |

## Behavior

- If the required file already exists: skip silently
- If neither source nor target exists: error, ask user to create one manually
- Before writing, show the user the generated content and ask for confirmation
- For Cargo.toml, also generate a minimal `src/lib.rs` or `src/main.rs` if `src/` doesn't exist (ask which)

## Cargo.toml Field Mapping from package.json

```toml
[package]
name = "my-lib"           # from name (strip @scope/)
version = "1.0.0"         # from version
edition = "2021"          # default
description = "..."       # from description
license = "MIT"           # from license
repository = "https://…"  # from repository.url
authors = ["Name <email>"]# from author
```

## jsr.json Generation from package.json

Uses the same logic as `packageJsonToJsrJson` in `src/utils/package.ts`:
- name, version mapped directly
- exports converted (nested import/require → flat)
- publish.include from files, publish.exclude from .npmignore/.gitignore

## package.json Generation from jsr.json

Uses the same logic as `jsrJsonToPackageJson` in `src/utils/package.ts`:
- name, version mapped directly
- files from publish.include + negated publish.exclude
- exports converted (flat → nested with import key)
