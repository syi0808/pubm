# Google Site Verification Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Google Search Console verification meta tag to both the landing page and all Starlight documentation pages in the `website` app.

**Architecture:** Keep the verification token in one website-local constant and wire both rendering paths to that shared value. Use the landing layout for the home page and Starlight's global `head` configuration for the docs so the tag is present site-wide without per-page duplication.

**Tech Stack:** Astro, Starlight, JavaScript, TypeScript

---

## Chunk 1: Lock In The Shared Metadata Source

### Task 1: Add a single source of truth for the verification token

**Files:**
- Create: `website/src/consts/site-verification.js`

- [ ] **Step 1: Write the failing test or verification target**

Use the website build as the verification target for this change. The build should fail if the new shared module is imported incorrectly or breaks Astro config usage.

- [ ] **Step 2: Create the shared token module**

Add a small exported constant for the Google site verification token so both rendering paths consume the same value.

- [ ] **Step 3: Run the website build to verify the baseline stays valid**

Run: `pnpm build`

Working directory: `website`

Expected: PASS.

## Chunk 2: Apply The Tag Across Both Rendering Paths

### Task 2: Render the verification tag on the landing page and docs

**Files:**
- Modify: `website/src/layouts/Landing.astro`
- Modify: `website/astro.config.mjs`
- Test: `website/src/consts/site-verification.js`

- [ ] **Step 1: Add the meta tag to the landing layout**

Import the shared token into the landing layout and add a `<meta name="google-site-verification">` tag in the existing `<head>` block.

- [ ] **Step 2: Add the same tag to Starlight global head config**

Import the shared token into the Astro config and pass a `head` entry to `starlight()` using the same token value.

- [ ] **Step 3: Run the website build to verify GREEN**

Run: `pnpm build`

Working directory: `website`

Expected: PASS.

## Chunk 3: Final Verification

### Task 3: Confirm the change is clean and isolated

**Files:**
- Modify if needed: `website/src/consts/site-verification.js`
- Modify if needed: `website/src/layouts/Landing.astro`
- Modify if needed: `website/astro.config.mjs`

- [ ] **Step 1: Run `git diff --check`**

Run: `git diff --check`

Expected: PASS with no whitespace errors.

- [ ] **Step 2: Re-run the website build**

Run: `pnpm build`

Working directory: `website`

Expected: PASS.
