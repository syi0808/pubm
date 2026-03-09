# Landing Page Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a pubm landing page + documentation site using Astro Starlight, deployed to GitHub Pages.

**Architecture:** Separate `website/` directory at repo root with its own Astro project. Custom landing page as the home route, Starlight handles `/docs/*` routes. GitHub Actions workflow deploys to GitHub Pages on push to main.

**Tech Stack:** Astro 5, Starlight, CSS custom properties, Google Fonts (Instrument Sans, JetBrains Mono), GitHub Pages

---

### Task 1: Scaffold Astro Starlight Project

**Files:**
- Create: `website/package.json`
- Create: `website/astro.config.mjs`
- Create: `website/tsconfig.json`
- Modify: root `package.json` (add workspace script)

**Step 1: Create website directory and initialize Astro Starlight**

```bash
cd /Users/sung-yein/Workspace/open-source/pubm
mkdir website
cd website
pnpm init
pnpm add astro @astrojs/starlight
```

**Step 2: Create `website/astro.config.mjs`**

```js
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://syi0808.github.io',
  base: '/pubm',
  integrations: [
    starlight({
      title: 'pubm',
      logo: {
        src: './src/assets/logo.svg',
      },
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/syi0808/pubm' },
      ],
      sidebar: [
        {
          label: 'Getting Started',
          items: [
            { label: 'Quick Start', slug: 'guides/quick-start' },
            { label: 'Configuration', slug: 'guides/configuration' },
          ],
        },
        {
          label: 'Reference',
          items: [
            { label: 'CLI Reference', slug: 'reference/cli' },
          ],
        },
      ],
      customCss: ['./src/styles/custom.css'],
      components: {
        Hero: './src/components/overrides/Hero.astro',
      },
    }),
  ],
});
```

**Step 3: Create `website/tsconfig.json`**

```json
{
  "extends": "astro/tsconfigs/strict"
}
```

**Step 4: Add scripts to root `package.json`**

Add to root `package.json` scripts:
```json
"dev:site": "cd website && pnpm dev",
"build:site": "cd website && pnpm build",
"preview:site": "cd website && pnpm preview"
```

**Step 5: Create `website/package.json` scripts**

Ensure `website/package.json` has:
```json
{
  "scripts": {
    "dev": "astro dev",
    "build": "astro build",
    "preview": "astro preview"
  }
}
```

**Step 6: Verify Astro runs**

```bash
cd /Users/sung-yein/Workspace/open-source/pubm/website
pnpm dev
```

Expected: Astro dev server starts, default Starlight page loads.

**Step 7: Commit**

```bash
git add website/ package.json
git commit -m "chore: scaffold Astro Starlight site in website/"
```

---

### Task 2: Design System — CSS Custom Properties & Global Styles

**Files:**
- Create: `website/src/styles/custom.css`
- Create: `website/src/styles/landing.css`
- Copy: `docs/logo.svg` → `website/src/assets/logo.svg`

**Step 1: Copy logo asset**

```bash
mkdir -p website/src/assets
cp docs/logo.svg website/src/assets/logo.svg
```

**Step 2: Create `website/src/styles/custom.css`**

Starlight theme overrides (applies to docs pages too):

```css
@import url('https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');

:root {
  --sl-color-accent-low: #1a1a2e;
  --sl-color-accent: #22d3ee;
  --sl-color-accent-high: #e8eaed;
  --sl-color-white: #e8eaed;
  --sl-color-gray-1: #c4c9d4;
  --sl-color-gray-2: #9ba3b5;
  --sl-color-gray-3: #7a8299;
  --sl-color-gray-4: #3d4455;
  --sl-color-gray-5: #272d3d;
  --sl-color-gray-6: #161b26;
  --sl-color-black: #0f1117;
  --sl-font: 'Instrument Sans', sans-serif;
  --sl-font-mono: 'JetBrains Mono', monospace;
}

[data-theme='dark'] {
  --sl-color-bg: #0f1117;
  --sl-color-bg-nav: rgba(22, 27, 38, 0.85);
  --sl-color-bg-sidebar: #0f1117;
  --sl-color-hairline-light: rgba(255, 255, 255, 0.06);
  --sl-color-hairline-shade: rgba(255, 255, 255, 0.03);
}
```

**Step 3: Create `website/src/styles/landing.css`**

Landing page specific styles with all design tokens:

```css
:root {
  --bg-primary: #0f1117;
  --bg-secondary: #161b26;
  --bg-glass: rgba(22, 27, 38, 0.7);
  --border: rgba(255, 255, 255, 0.06);
  --text-primary: #e8eaed;
  --text-muted: #7a8299;
  --accent-green: #34d399;
  --accent-cyan: #22d3ee;
  --accent-violet: #8b5cf6;
  --font-display: 'Instrument Sans', sans-serif;
  --font-mono: 'JetBrains Mono', monospace;
}

/* Dot grid background */
.landing-bg {
  background-color: var(--bg-primary);
  background-image: radial-gradient(rgba(255, 255, 255, 0.04) 1px, transparent 1px);
  background-size: 24px 24px;
}

/* Glass panel */
.glass-panel {
  background: var(--bg-glass);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid var(--border);
  border-radius: 12px;
}

/* Section divider */
.section-divider {
  border-top: 1px solid var(--border);
}

/* Staggered fade-in animation */
@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translateY(12px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.fade-in-up {
  animation: fadeInUp 0.5s ease-out forwards;
  opacity: 0;
}

/* Terminal line typing animation */
@keyframes typeLine {
  from {
    opacity: 0;
    transform: translateX(-4px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

.terminal-line {
  animation: typeLine 0.3s ease-out forwards;
  opacity: 0;
}
```

**Step 4: Verify styles load**

```bash
cd /Users/sung-yein/Workspace/open-source/pubm/website
pnpm dev
```

Expected: Starlight docs page loads with dark theme using custom colors and Instrument Sans font.

**Step 5: Commit**

```bash
git add website/src/styles/ website/src/assets/
git commit -m "feat(site): add design system tokens and global styles"
```

---

### Task 3: Landing Page — Layout Shell & Nav Bar

**Files:**
- Create: `website/src/pages/index.astro`
- Create: `website/src/layouts/Landing.astro`
- Create: `website/src/components/landing/NavBar.astro`

**Step 1: Create `website/src/layouts/Landing.astro`**

```astro
---
import '../styles/landing.css';

interface Props {
  title: string;
}

const { title } = Astro.props;
---

<!doctype html>
<html lang="en" data-theme="dark">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="generator" content={Astro.generator} />
    <title>{title}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
  </head>
  <body class="landing-bg">
    <slot />
  </body>
</html>

<style>
  body {
    margin: 0;
    padding: 0;
    color: var(--text-primary);
    font-family: var(--font-display);
    line-height: 1.6;
    -webkit-font-smoothing: antialiased;
  }
</style>
```

**Step 2: Create `website/src/components/landing/NavBar.astro`**

```astro
---
const base = import.meta.env.BASE_URL;
---

<nav class="navbar glass-panel">
  <div class="navbar-inner">
    <a href={base} class="navbar-logo">
      <img src={`${base}logo.svg`} alt="pubm" height="28" />
      <span>pubm</span>
    </a>
    <div class="navbar-links">
      <a href={`${base}guides/quick-start`}>Docs</a>
      <a href="https://github.com/syi0808/pubm" target="_blank" rel="noopener">GitHub</a>
    </div>
  </div>
</nav>

<style>
  .navbar {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 100;
    border: none;
    border-bottom: 1px solid var(--border);
    border-radius: 0;
  }
  .navbar-inner {
    max-width: 1200px;
    margin: 0 auto;
    padding: 0.75rem 1.5rem;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .navbar-logo {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    text-decoration: none;
    color: var(--text-primary);
    font-weight: 600;
    font-size: 1.125rem;
  }
  .navbar-links {
    display: flex;
    gap: 1.5rem;
  }
  .navbar-links a {
    color: var(--text-muted);
    text-decoration: none;
    font-size: 0.9rem;
    font-weight: 500;
    transition: color 0.2s;
  }
  .navbar-links a:hover {
    color: var(--text-primary);
  }
</style>
```

**Step 3: Create `website/src/pages/index.astro`** (shell)

```astro
---
import Landing from '../layouts/Landing.astro';
import NavBar from '../components/landing/NavBar.astro';
---

<Landing title="pubm — Multi-registry publish orchestration">
  <NavBar />
  <main style="padding-top: 4rem;">
    <!-- Sections will be added in subsequent tasks -->
    <section style="min-height: 100vh; display: flex; align-items: center; justify-content: center;">
      <h1 style="font-size: 3rem;">pubm</h1>
    </section>
  </main>
</Landing>
```

**Step 4: Copy logo to public**

```bash
mkdir -p website/public
cp docs/logo.svg website/public/logo.svg
```

**Step 5: Verify**

```bash
cd /Users/sung-yein/Workspace/open-source/pubm/website
pnpm dev
```

Expected: Landing page loads at `/pubm/` with nav bar and placeholder content. Nav bar is fixed, glassy, has logo and links.

**Step 6: Commit**

```bash
git add website/src/pages/ website/src/layouts/ website/src/components/ website/public/
git commit -m "feat(site): add landing page shell with nav bar"
```

---

### Task 4: Hero Section

**Files:**
- Create: `website/src/components/landing/Hero.astro`
- Create: `website/src/components/landing/TerminalPanel.astro`
- Modify: `website/src/pages/index.astro`

**Step 1: Create `website/src/components/landing/TerminalPanel.astro`**

```astro
<div class="terminal glass-panel">
  <div class="terminal-header">
    <span class="dot red"></span>
    <span class="dot yellow"></span>
    <span class="dot green"></span>
  </div>
  <div class="terminal-body">
    <div class="terminal-line" style="animation-delay: 0.4s">
      <span class="prompt">$</span> pubm patch --registry npm,jsr
    </div>
    <div class="terminal-line" style="animation-delay: 0.8s">&nbsp;</div>
    <div class="terminal-line" style="animation-delay: 1.0s">
      <span class="check">✓</span> Prerequisites validated
    </div>
    <div class="terminal-line" style="animation-delay: 1.3s">
      <span class="check">✓</span> Registry connections verified
    </div>
    <div class="terminal-line" style="animation-delay: 1.6s">
      <span class="check">✓</span> Version bumped to 1.3.0
    </div>
    <div class="terminal-line" style="animation-delay: 1.9s">
      <span class="spinner">◉</span> Publishing to registries...
    </div>
    <div class="terminal-line" style="animation-delay: 2.3s">
      &nbsp;&nbsp;<span class="check">✓</span> npm <span class="dots">···········</span> published
    </div>
    <div class="terminal-line" style="animation-delay: 2.6s">
      &nbsp;&nbsp;<span class="check">✓</span> jsr <span class="dots">···········</span> published
    </div>
    <div class="terminal-line" style="animation-delay: 3.0s">
      <span class="check">✓</span> Git tag v1.3.0 pushed
    </div>
  </div>
</div>

<style>
  .terminal {
    width: 100%;
    max-width: 520px;
    font-family: var(--font-mono);
    font-size: 0.85rem;
    line-height: 1.7;
    overflow: hidden;
  }
  .terminal-header {
    display: flex;
    gap: 6px;
    padding: 12px 16px 8px;
    border-bottom: 1px solid var(--border);
  }
  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
  }
  .dot.red { background: #ff5f57; }
  .dot.yellow { background: #febc2e; }
  .dot.green { background: #28c840; }
  .terminal-body {
    padding: 12px 16px 16px;
  }
  .prompt {
    color: var(--accent-cyan);
    font-weight: 500;
  }
  .check {
    color: var(--accent-green);
  }
  .spinner {
    color: var(--accent-cyan);
    text-shadow: 0 0 8px rgba(34, 211, 238, 0.4);
  }
  .dots {
    color: var(--text-muted);
    opacity: 0.4;
  }
</style>
```

**Step 2: Create `website/src/components/landing/Hero.astro`**

```astro
---
import TerminalPanel from './TerminalPanel.astro';
const base = import.meta.env.BASE_URL;
---

<section class="hero">
  <div class="hero-glow"></div>
  <div class="hero-inner">
    <div class="hero-text">
      <span class="badge glass-panel fade-in-up" style="animation-delay: 0s">v0.2.12</span>
      <h1 class="fade-in-up" style="animation-delay: 0.1s">
        Publish everywhere.<br />Roll back safely.
      </h1>
      <p class="hero-sub fade-in-up" style="animation-delay: 0.2s">
        Multi-registry publish orchestration for npm, jsr, crates.io, and private registries.
      </p>
      <div class="hero-cta fade-in-up" style="animation-delay: 0.3s">
        <a href={`${base}guides/quick-start`} class="btn-primary">Get Started →</a>
        <a href="https://github.com/syi0808/pubm" target="_blank" rel="noopener" class="btn-ghost">View on GitHub</a>
      </div>
    </div>
    <div class="hero-terminal fade-in-up" style="animation-delay: 0.3s">
      <TerminalPanel />
    </div>
  </div>
</section>

<style>
  .hero {
    position: relative;
    min-height: 100vh;
    display: flex;
    align-items: center;
    overflow: hidden;
  }
  .hero-glow {
    position: absolute;
    top: -200px;
    left: 50%;
    transform: translateX(-50%);
    width: 800px;
    height: 500px;
    background: radial-gradient(ellipse, rgba(34, 211, 238, 0.06) 0%, rgba(139, 92, 246, 0.04) 40%, transparent 70%);
    pointer-events: none;
  }
  .hero-inner {
    position: relative;
    max-width: 1200px;
    margin: 0 auto;
    padding: 0 1.5rem;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 3rem;
    align-items: center;
    width: 100%;
  }
  .badge {
    display: inline-block;
    padding: 0.25rem 0.75rem;
    font-family: var(--font-mono);
    font-size: 0.8rem;
    color: var(--accent-cyan);
    border-color: rgba(34, 211, 238, 0.2);
    border-radius: 999px;
    margin-bottom: 1.5rem;
  }
  h1 {
    font-family: var(--font-display);
    font-size: 3.25rem;
    font-weight: 700;
    line-height: 1.15;
    margin: 0 0 1.25rem;
    color: var(--text-primary);
  }
  .hero-sub {
    font-size: 1.125rem;
    color: var(--text-muted);
    margin: 0 0 2rem;
    max-width: 480px;
  }
  .hero-cta {
    display: flex;
    gap: 1rem;
  }
  .btn-primary {
    display: inline-flex;
    align-items: center;
    padding: 0.65rem 1.5rem;
    background: var(--accent-green);
    color: #0f1117;
    font-weight: 600;
    font-size: 0.9rem;
    border-radius: 8px;
    text-decoration: none;
    transition: opacity 0.2s;
  }
  .btn-primary:hover { opacity: 0.9; }
  .btn-ghost {
    display: inline-flex;
    align-items: center;
    padding: 0.65rem 1.5rem;
    border: 1px solid var(--border);
    color: var(--text-primary);
    font-weight: 500;
    font-size: 0.9rem;
    border-radius: 8px;
    text-decoration: none;
    transition: border-color 0.2s;
  }
  .btn-ghost:hover { border-color: rgba(255, 255, 255, 0.15); }
  .hero-terminal {
    display: flex;
    justify-content: flex-end;
  }

  @media (max-width: 768px) {
    .hero-inner {
      grid-template-columns: 1fr;
      text-align: center;
    }
    h1 { font-size: 2.25rem; }
    .hero-sub { max-width: none; }
    .hero-cta { justify-content: center; }
    .hero-terminal { justify-content: center; }
  }
</style>
```

**Step 3: Update `website/src/pages/index.astro`**

Replace the placeholder content:

```astro
---
import Landing from '../layouts/Landing.astro';
import NavBar from '../components/landing/NavBar.astro';
import Hero from '../components/landing/Hero.astro';
---

<Landing title="pubm — Multi-registry publish orchestration">
  <NavBar />
  <main>
    <Hero />
  </main>
</Landing>
```

**Step 4: Verify**

```bash
cd /Users/sung-yein/Workspace/open-source/pubm/website
pnpm dev
```

Expected: Hero section with left text + right terminal panel, staggered animations, glassy version badge, subtle glow at top.

**Step 5: Commit**

```bash
git add website/src/components/landing/Hero.astro website/src/components/landing/TerminalPanel.astro website/src/pages/index.astro
git commit -m "feat(site): add hero section with terminal animation"
```

---

### Task 5: Registry Orchestration Strip

**Files:**
- Create: `website/src/components/landing/RegistryStrip.astro`
- Modify: `website/src/pages/index.astro`

**Step 1: Create `website/src/components/landing/RegistryStrip.astro`**

Build the horizontal orchestration diagram with SVG connection lines and CSS animations. Registry nodes are glassy cards with icons. Center pubm node is larger with cyan glow. Connection lines use `stroke-dashoffset` animation. Small dots travel along lines. Entire section animates on scroll using `IntersectionObserver` in a `<script>` tag.

Key elements:
- 5 nodes: npm (red `#cb3837`), jsr (yellow `#f7df1e`), pubm center (cyan), crates.io (orange `#e6822e`), private (violet)
- SVG lines connecting center to each node
- Traveling dot animation on lines
- Caption below: "One command. Every registry. Atomic rollback if anything fails."
- `IntersectionObserver` adds `.visible` class to trigger animations

**Step 2: Add to `website/src/pages/index.astro`**

```astro
import RegistryStrip from '../components/landing/RegistryStrip.astro';
```

Add `<RegistryStrip />` after `<Hero />`.

**Step 3: Verify**

Expected: Scroll past hero → orchestration diagram animates in. Center node appears, lines extend, registry nodes fade in sequentially.

**Step 4: Commit**

```bash
git add website/src/components/landing/RegistryStrip.astro website/src/pages/index.astro
git commit -m "feat(site): add registry orchestration strip"
```

---

### Task 6: Feature Cards

**Files:**
- Create: `website/src/components/landing/FeatureCards.astro`
- Modify: `website/src/pages/index.astro`

**Step 1: Create `website/src/components/landing/FeatureCards.astro`**

4 glassy cards in a responsive grid (2x2 on desktop, 1 column on mobile). Each card has:
- Icon (SVG inline, 32px, colored per card)
- Title (Instrument Sans, 20px, bold)
- Description (`--text-muted`, 15px)
- Hover: border transitions to card accent color, subtle inset glow
- Scroll-triggered staggered fade-in (IntersectionObserver)

Cards:
1. Multi-Registry Publishing — cyan — connected nodes icon
2. Atomic Rollback — emerald — revert arrow icon
3. Preflight Validation — violet — shield check icon
4. TTY-Aware — cyan — terminal prompt icon

**Step 2: Add to index.astro after RegistryStrip**

**Step 3: Verify** — cards render in grid, hover effects work, scroll animation triggers

**Step 4: Commit**

```bash
git add website/src/components/landing/FeatureCards.astro website/src/pages/index.astro
git commit -m "feat(site): add feature cards section"
```

---

### Task 7: Workflow Strip

**Files:**
- Create: `website/src/components/landing/WorkflowStrip.astro`
- Modify: `website/src/pages/index.astro`

**Step 1: Create `website/src/components/landing/WorkflowStrip.astro`**

Horizontal pipeline with 4 steps connected by arrows. Each step is a glassy rounded pill. Steps activate left-to-right on scroll (IntersectionObserver + staggered delays). Mobile: vertical layout.

Steps:
1. `pubm add` — "Describe changes" — violet border
2. `pubm version` — "Bump & changelog" — cyan border
3. `pubm patch` — "Publish everywhere" — emerald border
4. ✓ Done — "Tags pushed, GitHub release drafted" — emerald pulse glow

Connecting arrows: thin SVG or CSS borders with `→` character.

**Step 2: Add to index.astro after FeatureCards**

**Step 3: Verify** — steps render horizontally, scroll triggers sequential activation

**Step 4: Commit**

```bash
git add website/src/components/landing/WorkflowStrip.astro website/src/pages/index.astro
git commit -m "feat(site): add workflow pipeline strip"
```

---

### Task 8: Install Section & Footer

**Files:**
- Create: `website/src/components/landing/InstallSection.astro`
- Create: `website/src/components/landing/Footer.astro`
- Modify: `website/src/pages/index.astro`

**Step 1: Create `website/src/components/landing/InstallSection.astro`**

- Headline: "Get started in seconds" (Instrument Sans, 32px, centered)
- Glassy terminal card (same style as hero terminal)
- Three commands with comments in `--text-muted`
- Copy button (top-right) — click handler swaps icon to emerald checkmark for 2s
- Two CTA buttons: "Read the Docs →" (emerald) + "View on GitHub" (ghost)

**Step 2: Create `website/src/components/landing/Footer.astro`**

- Darker background `#0a0d12`, thin top border
- 3-column grid: logo+tagline | links (Docs, GitHub, npm, jsr) | badges+license
- Bottom: `© 2026 Pubm` centered, `--text-muted`, 14px
- Mobile: stack columns

**Step 3: Add both to index.astro**

**Step 4: Verify** — install section renders with code block and copy button, footer has all links

**Step 5: Commit**

```bash
git add website/src/components/landing/InstallSection.astro website/src/components/landing/Footer.astro website/src/pages/index.astro
git commit -m "feat(site): add install section and footer"
```

---

### Task 9: Documentation Content

**Files:**
- Create: `website/src/content/docs/guides/quick-start.md`
- Create: `website/src/content/docs/guides/configuration.md`
- Create: `website/src/content/docs/reference/cli.md`

**Step 1: Create quick-start guide**

Migrate content from README.md "Quick Start" and "Core Workflow" sections into `quick-start.md` with Starlight frontmatter:

```md
---
title: Quick Start
description: Get started with pubm in under a minute.
---
```

**Step 2: Create configuration guide**

Migrate "Configuration and Plugins" section from README.md into `configuration.md`.

**Step 3: Create CLI reference**

Copy and adapt `docs/cli.md` content into `reference/cli.md` with Starlight frontmatter.

**Step 4: Verify**

```bash
cd /Users/sung-yein/Workspace/open-source/pubm/website
pnpm dev
```

Expected: Navigate to `/pubm/guides/quick-start` → docs page loads with Starlight sidebar, dark theme, custom fonts.

**Step 5: Commit**

```bash
git add website/src/content/
git commit -m "feat(site): add documentation content pages"
```

---

### Task 10: GitHub Pages Deployment

**Files:**
- Create: `.github/workflows/deploy-site.yml`

**Step 1: Create `.github/workflows/deploy-site.yml`**

```yaml
name: Deploy Site

on:
  push:
    branches:
      - main
    paths:
      - 'website/**'
      - '.github/workflows/deploy-site.yml'
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          run_install: false

      - uses: actions/setup-node@v4
        with:
          node-version: '24.x'
          cache: 'pnpm'

      - name: Install dependencies
        run: cd website && pnpm install --frozen-lockfile

      - name: Build site
        run: cd website && pnpm build

      - name: Upload artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: website/dist

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
```

**Step 2: Verify build locally**

```bash
cd /Users/sung-yein/Workspace/open-source/pubm/website
pnpm build
```

Expected: Build succeeds, output in `website/dist/`.

**Step 3: Add `website/dist` to `.gitignore`**

Append `website/dist` and `website/node_modules` to root `.gitignore`.

**Step 4: Commit**

```bash
git add .github/workflows/deploy-site.yml .gitignore
git commit -m "ci: add GitHub Pages deployment workflow for site"
```

---

### Task 11: Final Polish & Review

**Files:**
- Modify: various landing page components

**Step 1: Run full local build and preview**

```bash
cd /Users/sung-yein/Workspace/open-source/pubm/website
pnpm build && pnpm preview
```

**Step 2: Check all pages**

- `/pubm/` — landing page, all sections, animations
- `/pubm/guides/quick-start` — docs page with sidebar
- `/pubm/reference/cli` — CLI reference

**Step 3: Check responsive (mobile)**

- Verify hero stacks vertically
- Feature cards go to 1 column
- Workflow strip goes vertical
- Footer stacks columns
- Nav bar works on mobile

**Step 4: Fix any visual issues found**

**Step 5: Final commit**

```bash
git add -A website/
git commit -m "feat(site): polish landing page and docs site"
```
