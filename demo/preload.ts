/**
 * Bun preload script for pubm demo environment.
 *
 * Loaded via `bun --preload demo/preload.ts` BEFORE the CLI entry point.
 * Mocks:
 *   1. @napi-rs/keyring  → prevents OS keychain access
 *   2. globalThis.fetch   → intercepts all registry/GitHub API calls
 */

import { mock } from "bun:test";

// ── 1. Mock keyring ────────────────────────────────────────────
// secure-store.ts checks `Keyring?.Entry` — null means keyring is bypassed
mock.module("@napi-rs/keyring", () => ({
  default: null,
  Entry: null,
}));

// ── 2. Mock fetch ──────────────────────────────────────────────
const originalFetch = globalThis.fetch;

/** Random delay between min–max ms (simulates network latency) */
function delay(min: number, max: number): Promise<void> {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface MockRoute {
  match: (url: string, init?: RequestInit) => boolean;
  handle: (url: string, init?: RequestInit) => Response;
  /** [minMs, maxMs] — defaults to [50, 200] */
  latency?: [number, number];
}

const routes: MockRoute[] = [
  // ── npm registry ─────────────────────────────────────────────

  // npm token validation (whoami)
  {
    match: (url) => url.includes("registry.npmjs.org/-/whoami"),
    handle: () => Response.json({ username: "demo-user" }, { status: 200 }),
  },

  // npm version check → 404 (not yet published)
  {
    match: (url) => {
      const pattern = /registry\.npmjs\.org\/(@[^/]+\/[^/]+|[^@/][^/]*)\/\d+\.\d+\.\d+/;
      return pattern.test(url);
    },
    handle: () => new Response("Not Found", { status: 404 }),
  },

  // npm package info (exists)
  {
    match: (url) => {
      if (!url.includes("registry.npmjs.org/")) return false;
      if (url.includes("/-/")) return false;
      const rest = url.replace(/.*registry\.npmjs\.org\//, "").replace(/\/$/, "");
      return !rest.split("/").some((p) => /^\d+\.\d+\.\d+/.test(p));
    },
    handle: (url) => {
      const name = decodeURIComponent(
        url.replace(/.*registry\.npmjs\.org\//, "").replace(/\/$/, ""),
      );
      return Response.json(
        { name, "dist-tags": { latest: "1.0.0" }, versions: { "1.0.0": {} } },
        { status: 200 },
      );
    },
  },

  // ── JSR API (both api.jsr.io and jsr.io/api paths) ──────────

  // user info (token validation)
  {
    match: (url) =>
      (url.includes("api.jsr.io/user") || url.includes("jsr.io/api/user")) &&
      !url.includes("user/"),
    handle: () =>
      Response.json({ id: 1, login: "demo-user", name: "Demo User" }, { status: 200 }),
  },

  // user scopes
  {
    match: (url) =>
      url.includes("api.jsr.io/user/scopes") ||
      url.includes("jsr.io/api/user/scopes"),
    handle: () => Response.json([{ scope: "demo" }], { status: 200 }),
  },

  // user member (scope permission)
  {
    match: (url) =>
      url.includes("api.jsr.io/user/member/") ||
      url.includes("jsr.io/api/user/member/"),
    handle: () =>
      Response.json({ scope: "demo", isAdmin: true }, { status: 200 }),
  },

  // package info
  {
    match: (url) =>
      /api\.jsr\.io\/scopes\/[^/]+\/packages\/[^/]+$/.test(url) ||
      /jsr\.io\/api\/scopes\/[^/]+\/packages\/[^/]+$/.test(url),
    handle: () =>
      Response.json({ scope: "demo", name: "hello", description: "A demo package" }, { status: 200 }),
  },

  // version check → 404 (not yet published)
  {
    match: (url) =>
      /api\.jsr\.io\/scopes\/[^/]+\/packages\/[^/]+\/versions\//.test(url) ||
      /jsr\.io\/api\/scopes\/[^/]+\/packages\/[^/]+\/versions\//.test(url),
    handle: () => new Response("Not Found", { status: 404 }),
  },

  // create scope (POST)
  {
    match: (url, init) =>
      (url.includes("api.jsr.io/scopes") || url.includes("jsr.io/api/scopes")) &&
      init?.method === "POST" &&
      !url.includes("/packages"),
    handle: () => Response.json({ scope: "demo" }, { status: 201 }),
  },

  // create/delete package
  {
    match: (url, init) =>
      (/api\.jsr\.io\/scopes\/[^/]+\/packages/.test(url) ||
        /jsr\.io\/api\/scopes\/[^/]+\/packages/.test(url)) &&
      (init?.method === "POST" || init?.method === "DELETE"),
    handle: (_url, init) =>
      Response.json({}, { status: init?.method === "DELETE" ? 204 : 201 }),
  },

  // package page (isPublished check via jsr.io/@scope/name)
  {
    match: (url) => url.includes("jsr.io/@") && !url.includes("api.jsr.io"),
    handle: () =>
      Response.json({ name: "@demo/hello", description: "A demo package" }, { status: 200 }),
  },

  // ── crates.io API ────────────────────────────────────────────

  // ping
  {
    match: (url) => url.includes("crates.io/api/v1") && !url.includes("/crates/"),
    handle: () => Response.json({}, { status: 200 }),
  },

  // crate info
  {
    match: (url) => /crates\.io\/api\/v1\/crates\/[^/]+$/.test(url),
    handle: (url) => {
      const name = url.split("/crates/")[1];
      return Response.json({ crate: { name, max_version: "1.0.0" } }, { status: 200 });
    },
  },

  // crate version check → 404 (not yet published)
  {
    match: (url) => /crates\.io\/api\/v1\/crates\/[^/]+\/\d+\.\d+\.\d+/.test(url),
    handle: () => new Response("Not Found", { status: 404 }),
  },

  // ── GitHub API ───────────────────────────────────────────────

  // create release (slower — simulates GitHub API)
  {
    latency: [300, 800],
    match: (url, init) =>
      url.includes("api.github.com/repos/") &&
      url.includes("/releases") &&
      init?.method === "POST" &&
      !url.includes("?name="),
    handle: (url) => {
      const match = url.match(/repos\/([^/]+)\/([^/]+)\/releases/);
      const owner = match?.[1] ?? "demo";
      const repo = match?.[2] ?? "demo-package";
      return Response.json(
        {
          html_url: `https://github.com/${owner}/${repo}/releases/tag/v1.1.0`,
          upload_url: `https://uploads.github.com/repos/${owner}/${repo}/releases/1/assets{?name,label}`,
          id: 1,
          tag_name: "v1.1.0",
          draft: false,
        },
        { status: 201 },
      );
    },
  },

  // upload release asset (slower — simulates file upload)
  {
    latency: [200, 600],
    match: (url, init) =>
      url.includes("uploads.github.com") && init?.method === "POST",
    handle: (url) => {
      const name = new URL(url).searchParams.get("name") ?? "asset";
      return Response.json(
        { name, browser_download_url: `https://github.com/demo/releases/download/${name}` },
        { status: 201 },
      );
    },
  },

  // ── npm update check (notifyNewVersion) ──────────────────────
  {
    match: (url) => url.includes("registry.npmjs.org/pubm"),
    handle: () =>
      Response.json(
        { name: "pubm", "dist-tags": { latest: "0.0.0" }, versions: {} },
        { status: 200 },
      ),
  },
];

globalThis.fetch = async (
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> => {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;

  for (const route of routes) {
    if (route.match(url, init)) {
      const [min, max] = route.latency ?? [40, 180];
      await delay(min, max);
      return route.handle(url, init);
    }
  }

  // Pass through unmatched requests (shouldn't happen in demo)
  console.warn(`[demo] Unhandled fetch: ${init?.method ?? "GET"} ${url}`);
  return originalFetch(input, init);
};
