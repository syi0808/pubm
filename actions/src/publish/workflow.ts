import { parseReleasePrBodyMetadata } from "@pubm/core";

export function isPushToBaseBranch(input: {
  eventName: string;
  ref: string;
  baseBranch: string;
}): boolean {
  return (
    input.eventName === "push" && input.ref === `refs/heads/${input.baseBranch}`
  );
}

export function hasLabel(
  labels: readonly { name?: string | null }[],
  labelName: string,
): boolean {
  return labels.some((label) => label.name === labelName);
}

export function branchPrefixFromTemplate(template?: string | null): string {
  const branchTemplate = template ?? "pubm/release/{scopeSlug}";
  const firstTokenIndex = branchTemplate.indexOf("{");
  return firstTokenIndex === -1
    ? branchTemplate
    : branchTemplate.slice(0, firstTokenIndex);
}

export function isMergedReleasePullRequest(
  pr: {
    merged?: boolean | null;
    base?: { ref?: string | null } | null;
    head?: { ref?: string | null } | null;
    body?: string | null;
    labels?: readonly { name?: string | null }[] | null;
  },
  input: {
    baseBranch: string;
    label: string;
    branchPrefix: string;
  },
): boolean {
  const matchesBranch = input.branchPrefix
    ? pr.head?.ref?.startsWith(input.branchPrefix)
    : false;
  const metadata = parseReleasePrBodyMetadata(pr.body);

  return Boolean(
    pr.merged &&
      pr.base?.ref === input.baseBranch &&
      (metadata.isReleasePr || matchesBranch) &&
      hasLabel(pr.labels ?? [], input.label),
  );
}

export function isUsablePushRange(
  beforeSha?: string,
  afterSha?: string,
): boolean {
  return Boolean(
    beforeSha &&
      afterSha &&
      !/^[0]+$/.test(beforeSha) &&
      !/^[0]+$/.test(afterSha),
  );
}
