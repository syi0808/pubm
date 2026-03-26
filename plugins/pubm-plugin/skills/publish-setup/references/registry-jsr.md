# JSR Registry Constraints

## Prerequisites

The `jsr` npm package must be installed as a devDependency. pubm calls the `jsr` CLI directly for publishing.

Install it with the project's package manager, based on the lock file: `pnpm-lock.yaml` means pnpm, `yarn.lock` means yarn, and `package-lock.json` means npm.

## Naming

**JSR requires scoped names.** The `name` field must follow `@scope/package-name`.

- If `package.json` or `deno.json` name is already scoped (e.g. `@myorg/foo`), use it as-is.
- If unscoped, such as `foo`, ask the user for a JSR scope, such as `@username/foo`.

## jsr.json Template (from package.json or deno.json)

When generating `jsr.json`, use either `package.json` or `deno.json`/`deno.jsonc` as the source:

```json
{
  "name": "@scope/package-name",
  "version": "<version from package.json or deno.json>",
  "exports": "<converted from package.json exports or deno.json exports>",
  "publish": {
    "include": ["<from files array, non-negated entries>"],
    "exclude": ["<from files array, negated entries (strip !), plus .npmignore/.gitignore entries>"]
  }
}
```

### From deno.json/deno.jsonc

If a `deno.json` or `deno.jsonc` file exists, use it as the source for Deno projects publishing to JSR:
- `name` field: must be JSR-scoped (e.g., `@scope/package-name`)
- `version` field: semantic version
- `exports` field: entry points for JSR
- `publish` field: if present, use its `include` and `exclude` arrays directly

## Exports Conversion

Convert `package.json` exports to `jsr.json` format:
- Flatten nested `import`/`require` objects to plain strings (use the `import` value)
- Example: `{ ".": { "import": "./dist/index.js", "require": "./dist/index.cjs" } }` → `{ ".": "./dist/index.js" }`

## publish.include / publish.exclude Mapping

From the `files` array in `package.json`:
- Non-negated entries → `publish.include`
- Negated entries (prefixed with `!`) → strip `!` and add to `publish.exclude`
- Also add relevant entries from `.npmignore` / `.gitignore` to `publish.exclude`

## Authentication

- **Local**: Tokens encrypted with AES-256-CBC and stored in `.pubm/` directory. pubm prompts interactively on first use.
- **CI**: Set `JSR_TOKEN` environment variable. Create token at jsr.io/account/tokens/create (select "Interact with the JSR API").
