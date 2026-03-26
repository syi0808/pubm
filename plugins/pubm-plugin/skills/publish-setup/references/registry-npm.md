# npm Registry Constraints

## package.json Template (from jsr.json or deno.json)

```json
{
  "name": "<name from jsr.json or deno.json>",
  "version": "<version from jsr.json or deno.json>",
  "files": ["<from publish.include, plus negated publish.exclude>"],
  "exports": "<converted from jsr.json or deno.json exports>"
}
```

When generating `package.json` for npm publishing, use either `jsr.json` or `deno.json`/`deno.jsonc` as the source.

## Exports Conversion

Convert `jsr.json` exports to `package.json` format:
- Wrap flat strings in `{ import: ... }` objects
- Example: `{ ".": "./dist/index.js" }` → `{ ".": { "import": "./dist/index.js" } }`

## files Array Mapping

From the `publish` field in `jsr.json`:
- `publish.include` entries → add directly to `files`
- `publish.exclude` entries → prefix with `!` and add to `files`

## Authentication

- **Local**: Run `npm login` to authenticate via npm CLI.
- **CI**: Set `NODE_AUTH_TOKEN` environment variable. Create token at npmjs.com > Access Tokens > Generate New Token > Automation.

## CI Notes

- pubm automatically uses `npm publish --provenance --access public` in CI.
- `id-token: write` permission is needed in GitHub Actions for provenance.
- If your package has 2FA enabled for token-based writes, publishing will fail in CI. Disable "Require two-factor authentication for write actions" in the package access settings on npmjs.com, or use an automation token.
