# JSR Registry Constraints

## Prerequisites

The `jsr` npm package must be installed as a devDependency in the project. pubm invokes the `jsr` CLI directly for publishing.

Install using your project's package manager (detect from lock files: `pnpm-lock.yaml` → pnpm, `yarn.lock` → yarn, `package-lock.json` → npm).

## Naming

**JSR requires scoped names.** The `name` field MUST follow the format `@scope/package-name`.

- If `package.json` name is already scoped (e.g. `@myorg/foo`), use it as-is.
- If unscoped (e.g. `foo`), ask the user for a JSR scope (e.g. `@username/foo`).

## jsr.json Template (from package.json)

```json
{
  "name": "@scope/package-name",
  "version": "<version from package.json>",
  "exports": "<converted from package.json exports>",
  "publish": {
    "include": ["<from files array, non-negated entries>"],
    "exclude": ["<from files array, negated entries (strip !), plus .npmignore/.gitignore entries>"]
  }
}
```

## Exports Conversion

Convert `package.json` exports to `jsr.json` format:
- Flatten nested `import`/`require` objects to plain strings (use the `import` value)
- Example: `{ ".": { "import": "./dist/index.js", "require": "./dist/index.cjs" } }` → `{ ".": "./dist/index.js" }`

## publish.include / publish.exclude Mapping

From `package.json` `files` array:
- Non-negated entries → `publish.include`
- Negated entries (prefixed with `!`) → strip `!` and add to `publish.exclude`
- Also add relevant entries from `.npmignore` / `.gitignore` to `publish.exclude`

## Authentication

- **Local**: Tokens encrypted with AES-256-CBC and stored in `.pubm/` directory. pubm prompts interactively on first use.
- **CI**: Set `JSR_TOKEN` environment variable. Create token at jsr.io/account/tokens/create (select "Interact with the JSR API").
