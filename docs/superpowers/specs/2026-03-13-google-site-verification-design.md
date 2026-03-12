# Google Site Verification Design

## Goal

Apply the provided Google Search Console verification meta tag across the entire `website` app, covering both the custom landing page and all Starlight documentation pages.

## Current Structure

The website has two independent head-rendering paths:

- [`website/src/layouts/Landing.astro`](/Users/sung-yein/Workspace/open-source/pubm/website/src/layouts/Landing.astro) renders the landing page HTML directly.
- [`website/astro.config.mjs`](/Users/sung-yein/Workspace/open-source/pubm/website/astro.config.mjs) configures Starlight, which renders the documentation pages and supports global `<head>` entries through its `head` option.

Because these paths are separate, adding the tag in only one place would leave part of the site unverified.

## Constraints

- Keep the change narrow and easy to audit.
- Avoid per-page duplication.
- Keep the verification token consistent between landing and docs.
- Preserve the existing rendering setup for both Astro and Starlight pages.

## Approved Approach

### Define the verification token once

Store the verification token in a small website-local constant module so both rendering paths can consume the same value.

### Inject the tag into the landing layout

Update [`website/src/layouts/Landing.astro`](/Users/sung-yein/Workspace/open-source/pubm/website/src/layouts/Landing.astro) to render:

- `<meta name="google-site-verification" content="...">`

inside the existing `<head>` block.

### Inject the tag into Starlight globally

Update the `starlight()` configuration in [`website/astro.config.mjs`](/Users/sung-yein/Workspace/open-source/pubm/website/astro.config.mjs) to add the same tag through its global `head` configuration. This ensures the verification tag appears on every documentation page without overriding Starlight components.

## File Changes

- Create [`website/src/consts/site-verification.js`](/Users/sung-yein/Workspace/open-source/pubm/website/src/consts/site-verification.js) to hold the verification token.
- Modify [`website/src/layouts/Landing.astro`](/Users/sung-yein/Workspace/open-source/pubm/website/src/layouts/Landing.astro) to render the tag for the landing page.
- Modify [`website/astro.config.mjs`](/Users/sung-yein/Workspace/open-source/pubm/website/astro.config.mjs) to configure the tag for all Starlight pages.

## Validation

Before calling this complete:

1. Build the website with `pnpm build` from [`website`](/Users/sung-yein/Workspace/open-source/pubm/website).
2. Confirm the landing page build still succeeds after importing the shared constant.
3. Confirm the Starlight config accepts the new `head` entry and the site build completes successfully.

## Notes

This design intentionally uses Starlight's built-in global `head` support instead of overriding its `Head` component. The built-in hook is sufficient for a single static verification tag and keeps the implementation minimal.
