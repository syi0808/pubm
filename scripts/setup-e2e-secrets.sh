#!/bin/bash
set -euo pipefail

# =============================================================================
# E2E Fixture Repos — Secret Setup Script
#
# Usage (interactive - prompts for each token):
#   bash scripts/setup-e2e-secrets.sh
#
# Usage (env vars - no prompts):
#   NPM_TOKEN=xxx JSR_TOKEN=xxx CARGO_REGISTRY_TOKEN=xxx bash scripts/setup-e2e-secrets.sh
#
# Skip a token by leaving it empty (press Enter at the prompt).
# =============================================================================

ORG="pubm-org"

prompt_token() {
  local name="$1"
  local desc="$2"
  local env_val="${!name:-}"

  if [ -n "$env_val" ]; then
    echo "$env_val"
    return
  fi

  read -rsp "  $name ($desc): " value
  echo "" >&2
  echo "$value"
}

set_secret() {
  local repo="$1"
  local name="$2"
  local value="$3"

  if [ -z "$value" ]; then
    return
  fi

  echo "  ✓ ${ORG}/${repo} → ${name}"
  echo "${value}" | gh secret set "${name}" --repo "${ORG}/${repo}"
}

echo "=== E2E Fixture Secrets Setup ==="
echo ""
echo "Enter tokens (or set as env vars to skip prompts):"
echo ""

NPM_TOKEN=$(prompt_token NPM_TOKEN "@pubm-test npm publish token")
JSR_TOKEN=$(prompt_token JSR_TOKEN "@syi0808 jsr publish token")
CARGO_REGISTRY_TOKEN=$(prompt_token CARGO_REGISTRY_TOKEN "crates.io API token")
PUBM_BREW_GITHUB_TOKEN=$(prompt_token PUBM_BREW_GITHUB_TOKEN "GitHub PAT for homebrew-tap")
PUBM_ORG_TOKEN=$(prompt_token PUBM_ORG_TOKEN "GitHub PAT for pubm-org actions")

echo ""
echo "── NPM_TOKEN (14 repos) ──"
for repo in \
  example-single-npm \
  example-monorepo-fixed-npm \
  example-monorepo-independent-npm \
  example-multi-registry \
  example-monorepo-npm-jsr \
  example-monorepo-npm-crate-jsr \
  example-with-plugins \
  example-with-changesets \
  example-fixed-changesets \
  example-fixed-multi-registry \
  example-independent-conventional-commits \
  example-linked-groups \
  example-prerelease \
  example-cross-registry-names; do
  set_secret "$repo" "NPM_TOKEN" "$NPM_TOKEN"
done

echo ""
echo "── JSR_TOKEN (6 repos) ──"
for repo in \
  example-single-jsr \
  example-multi-registry \
  example-monorepo-npm-jsr \
  example-monorepo-npm-crate-jsr \
  example-fixed-multi-registry \
  example-cross-registry-names; do
  set_secret "$repo" "JSR_TOKEN" "$JSR_TOKEN"
done

echo ""
echo "── CARGO_REGISTRY_TOKEN (2 repos) ──"
for repo in \
  example-single-crate \
  example-monorepo-npm-crate-jsr; do
  set_secret "$repo" "CARGO_REGISTRY_TOKEN" "$CARGO_REGISTRY_TOKEN"
done

echo ""
echo "── PUBM_BREW_GITHUB_TOKEN (1 repo) ──"
set_secret "example-with-plugins" "PUBM_BREW_GITHUB_TOKEN" "$PUBM_BREW_GITHUB_TOKEN"

echo ""
echo "── PUBM_ORG_TOKEN (pubm main repo) ──"
if [ -n "$PUBM_ORG_TOKEN" ]; then
  echo "  ✓ syi0808/pubm → PUBM_ORG_TOKEN"
  echo "${PUBM_ORG_TOKEN}" | gh secret set "PUBM_ORG_TOKEN" --repo "syi0808/pubm"
fi

echo ""
echo "=== Done ==="
