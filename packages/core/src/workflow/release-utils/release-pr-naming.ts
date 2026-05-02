import type { PubmContext } from "../../context.js";
import { packageKey } from "../../utils/package-key.js";
import type { ReleasePrScope } from "./scope.js";

export interface ReleasePrTemplateInput {
  ctx?: PubmContext;
  scope: ReleasePrScope;
  version: string;
  template: string;
}

export function slugifyReleasePrToken(value: string): string {
  const slug = value
    .normalize("NFKD")
    .split("")
    .filter((char) => char.charCodeAt(0) <= 127)
    .join("")
    .toLowerCase()
    .replace(/::/g, "-")
    .replace(/[/@]+/g, "-")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");

  return slug || "release";
}

export function renderReleasePrTemplate({
  ctx,
  scope,
  version,
  template,
}: ReleasePrTemplateInput): string {
  const packageKeyValue = [...scope.packageKeys].sort().join("+");
  const packageKeySlug = slugifyReleasePrToken(packageKeyValue);
  const scopeValue =
    scope.kind === "package" && ctx
      ? packageNameForScope(ctx, scope)
      : scope.displayName;

  return replaceTemplateToken(
    replaceTemplateToken(
      replaceTemplateToken(
        replaceTemplateToken(
          replaceTemplateToken(template, "scope", scopeValue),
          "scopeSlug",
          scope.slug,
        ),
        "packageKey",
        packageKeyValue,
      ),
      "packageKeySlug",
      packageKeySlug,
    ),
    "version",
    version,
  );
}

export function renderReleasePrBranch(
  input: Omit<ReleasePrTemplateInput, "template"> & { template?: string },
): string {
  return renderReleasePrTemplate({
    ...input,
    template: input.template ?? "pubm/release/{scopeSlug}",
  });
}

export function renderReleasePrTitle(
  input: Omit<ReleasePrTemplateInput, "template"> & { template?: string },
): string {
  return renderReleasePrTemplate({
    ...input,
    template: input.template ?? "chore(release): {scope} {version}",
  });
}

function packageNameForScope(ctx: PubmContext, scope: ReleasePrScope): string {
  const key = scope.packageKeys[0];
  return (
    ctx.config.packages.find((pkg) => packageKey(pkg) === key)?.name ?? key
  );
}

function replaceTemplateToken(
  template: string,
  token: string,
  value: string,
): string {
  return template.split(`{${token}}`).join(value);
}
