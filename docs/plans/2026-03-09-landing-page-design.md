# Landing Page Design

## Overview

pubm 랜딩 페이지 + 문서 사이트. Starlight (Astro) 기반, GitHub Pages 호스팅.

## Approach

Starlight 커스텀 홈 + 문서: 홈페이지는 커스텀 Astro 페이지로 완전 교체, 문서는 Starlight 기본 기능 활용.

## Design Direction

- **Aesthetic**: Infrastructure-grade DevTools, modern control plane / release orchestration dashboard
- **Mood**: serious, trustworthy, technical, premium, calm, modern, engineering-first
- **NO pixel art**

## Design Tokens

| Token | Value |
|-------|-------|
| `--bg-primary` | `#0f1117` (deep graphite) |
| `--bg-secondary` | `#161b26` (midnight panel) |
| `--bg-glass` | `rgba(22, 27, 38, 0.7)` + `backdrop-filter: blur(12px)` |
| `--border` | `rgba(255, 255, 255, 0.06)` |
| `--text-primary` | `#e8eaed` |
| `--text-muted` | `#7a8299` |
| `--accent-green` | `#34d399` (emerald, success) |
| `--accent-cyan` | `#22d3ee` (data flow) |
| `--accent-violet` | `#8b5cf6` (restrained accent) |
| `--font-display` | `Instrument Sans` |
| `--font-mono` | `JetBrains Mono` |

## Background Treatment

- Subtle dot grid (`radial-gradient`, opacity 0.03~0.05)
- Hero top: suppressed cyan→violet gradient glow
- Section dividers: `border-top: 1px solid var(--border)`

## Page Structure

### 1. Nav Bar

- Logo + Docs/GitHub links
- Glassy semi-transparent (`--bg-glass`)

### 2. Hero

Left-right split (mobile: vertical stack).

**Left (Text)**:
- Version badge: `v0.2.12`, glassy, cyan border
- Headline: "Publish everywhere." + line break + "Roll back safely." — Instrument Sans, 48-56px, bold
- Subline: "Multi-registry publish orchestration for npm, jsr, crates.io, and private registries." — `--text-muted`, 18px
- CTA buttons: `Get Started →` (emerald bg) + `View on GitHub` (ghost)

**Right (Terminal Panel)**:
- Glassy card with simulated pubm execution
- Three dots decoration (red/yellow/green)
- `$` prompt in cyan, checkmarks in emerald, spinner in cyan glow
- Typing animation, lines appear sequentially (CSS `animation-delay`)

```
$ pubm patch --registry npm,jsr

  ✓ Prerequisites validated
  ✓ Registry connections verified
  ✓ Version bumped to 1.3.0
  ◉ Publishing to registries...
    ✓ npm ··········· published
    ✓ jsr ··········· published
  ✓ Git tag v1.3.0 pushed
```

**Animation**: Text fade-in from left (staggered 0.1s), terminal appears after 0.3s delay, each line at 0.15s intervals.

### 3. Registry Orchestration Strip

Horizontal layout: `[npm] ── [jsr] ── [pubm] ── [crates.io] ── [private]`

- Center pubm node: `--accent-cyan` border glow, larger size
- Each registry node: glassy rounded-square, icon + name inside
- Connection lines: thin dashed, cyan gradient to each node color
- npm: red, jsr: yellow, crates.io: orange, private: violet

**Animation**: On scroll entry — center node appears first → lines extend outward (stroke-dashoffset) → registry nodes fade-in + scale sequentially → repeating dot animation along lines (data flow direction).

**Caption**: "One command. Every registry. Atomic rollback if anything fails." — `--text-muted`, centered, 16px

### 4. Feature Cards

3-column grid (mobile: 1 column). 4 glassy cards.

| Card | Icon Color | Title | Description |
|------|-----------|-------|-------------|
| 1 | cyan | Multi-Registry Publishing | npm, jsr, crates.io, and private registries — all in one command. Concurrent where possible, sequential where dependencies require it. |
| 2 | emerald | Atomic Rollback | If any registry fails, pubm auto-reverses git commits, tags, and stashes. No more half-released states. |
| 3 | violet | Preflight Validation | Branch rules, clean tree, remote sync, registry ping, login status, publish permissions — all checked before any side effect. |
| 4 | cyan | TTY-Aware | Interactive prompts in your terminal, headless in CI. Same command, both environments. No flags to remember. |

**Card Style**: `border: 1px solid var(--border)`, hover → border changes to card icon color (0.2s transition), subtle inset glow matching icon color (opacity 0.05). Internal: icon(32px) → title(Instrument Sans, 20px, bold) → description(`--text-muted`, 15px).

**Animation**: Staggered fade-in + translateY(12px), 0.1s intervals on scroll.

### 5. Workflow Strip

Horizontal pipeline steps (mobile: vertical). CI/CD pipeline UI feel.

| Step | Command | Label | Subtext | Border Color |
|------|---------|-------|---------|-------------|
| 1 | `pubm add` | Describe changes | Create a changeset | violet |
| 2 | `pubm version` | Bump & changelog | Consume changesets, update versions | cyan |
| 3 | `pubm patch` | Publish everywhere | All registries, atomic rollback | emerald |
| 4 | ✓ | Done | Tags pushed, GitHub release drafted | emerald glow |

**Style**: Each step is a glassy rounded pill (~80px height). Command in mono 14px + label + subtext. Thin connecting lines with arrows.

**Animation**: On scroll — steps activate left-to-right sequentially. Lines draw out → next step fades in → border color transitions. Final Done step: emerald pulse glow.

### 6. Install / Quick Start

Center-aligned.

**Headline**: "Get started in seconds" — Instrument Sans, 32px

**Terminal card** (same glassy style as hero):
```
$ npm i -g pubm

$ pubm patch --preview   # see what would happen
$ pubm patch              # publish for real
```

- Copy button top-right (click → emerald check transition)
- `#` comments in `--text-muted`, commands in `--text-primary`, `$` in cyan

**CTA buttons**: `Read the Docs →` (emerald) + `View on GitHub` (ghost)

### 7. Footer

Background: `#0a0d12` (darker than primary). Thin top border.

3-column layout:
- **Left**: pubm logo (small) + "Multi-registry publish orchestration"
- **Center**: Links — Docs, GitHub, npm, jsr
- **Right**: npm/jsr version badges + Apache-2.0 license

Bottom: `© 2026 Pubm` — `--text-muted`, 14px, centered
