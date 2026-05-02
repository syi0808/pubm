import { inc, valid } from "semver";
import type { BumpType } from "../../changeset/parser.js";
import type { PubmContext, VersionPlan } from "../../context.js";
import { packageKey } from "../../utils/package-key.js";
import type { ReleasePrScope } from "./scope.js";

export type ReleasePrBumpOverride = BumpType | "prerelease";

export type ReleasePrOverride =
  | {
      source: "label" | "slash";
      kind: "bump";
      bump: ReleasePrBumpOverride;
    }
  | {
      source: "slash";
      kind: "release-as";
      version: string;
    };

export interface ReleasePrOverrideError {
  message: string;
  command?: string;
}

export interface SlashCommandComment {
  body: string;
  createdAt?: string | number | Date;
}

export interface ParseReleasePrSlashCommandsResult {
  override?: ReleasePrOverride;
  errors: ReleasePrOverrideError[];
}

export interface ResolveReleasePrOverrideInput {
  labels?: readonly string[];
  bumpLabels?: Partial<Record<ReleasePrBumpOverride, string>>;
  comments?: readonly SlashCommandComment[];
}

export const DEFAULT_RELEASE_PR_BUMP_LABELS: Record<
  ReleasePrBumpOverride,
  string
> = {
  patch: "release:patch",
  minor: "release:minor",
  major: "release:major",
  prerelease: "release:prerelease",
};

const BUMPS = new Set(["patch", "minor", "major", "prerelease"]);

export function parseReleasePrLabelOverride(
  labels: readonly string[],
  bumpLabels: Partial<Record<ReleasePrBumpOverride, string>> = {},
): ReleasePrOverride | undefined {
  const configured = { ...DEFAULT_RELEASE_PR_BUMP_LABELS, ...bumpLabels };
  const labelSet = new Set(labels);
  const matches = (Object.keys(configured) as ReleasePrBumpOverride[]).filter(
    (bump) => labelSet.has(configured[bump]),
  );

  if (matches.length === 0) return undefined;
  return { source: "label", kind: "bump", bump: highestBump(matches) };
}

export function parseReleasePrSlashCommand(command: string): ReleasePrOverride {
  const normalized = command.trim().replace(/\s+/g, " ");
  const bumpMatch = normalized.match(/^\/pubm bump ([^\s]+)$/i);
  if (bumpMatch) {
    const bump = bumpMatch[1].toLowerCase();
    if (BUMPS.has(bump)) {
      return {
        source: "slash",
        kind: "bump",
        bump: bump as ReleasePrBumpOverride,
      };
    }
    throw new Error(`Unsupported bump override "${bump}"`);
  }

  const releaseAsMatch = normalized.match(/^\/pubm release-as ([^\s]+)$/i);
  if (releaseAsMatch) {
    const version = releaseAsMatch[1];
    if (!valid(version)) {
      throw new Error(`Invalid release-as version "${version}"`);
    }
    return { source: "slash", kind: "release-as", version };
  }

  throw new Error(`Unsupported pubm command "${normalized}"`);
}

export function parseReleasePrSlashCommands(
  comments: readonly SlashCommandComment[],
): ParseReleasePrSlashCommandsResult {
  const errors: ReleasePrOverrideError[] = [];
  const validCommands = comments
    .flatMap((comment, commentIndex) =>
      extractCommands(comment.body).map((command, commandIndex) => ({
        command,
        createdAt: timeValue(comment.createdAt, commentIndex, commandIndex),
      })),
    )
    .map((entry) => {
      try {
        return {
          ...entry,
          override: parseReleasePrSlashCommand(entry.command),
        };
      } catch (error) {
        errors.push({
          command: entry.command,
          message: error instanceof Error ? error.message : String(error),
        });
        return undefined;
      }
    })
    .filter((entry): entry is NonNullable<typeof entry> => !!entry)
    .sort((a, b) => b.createdAt - a.createdAt);

  return { override: validCommands[0]?.override, errors };
}

export function resolveReleasePrOverride({
  labels = [],
  bumpLabels,
  comments = [],
}: ResolveReleasePrOverrideInput): {
  override?: ReleasePrOverride;
  errors: ReleasePrOverrideError[];
} {
  const slash = parseReleasePrSlashCommands(comments);
  return {
    override: slash.override ?? parseReleasePrLabelOverride(labels, bumpLabels),
    errors: slash.errors,
  };
}

export function applyReleaseOverride(
  ctx: PubmContext,
  plan: VersionPlan,
  scope: ReleasePrScope,
  override: ReleasePrOverride,
): VersionPlan {
  const packageKeys = new Set(scope.packageKeys);
  if (override.kind === "release-as") {
    if (
      scope.packageKeys.length > 1 &&
      scope.kind !== "fixed" &&
      scope.kind !== "group"
    ) {
      throw new Error(
        "release-as can target multiple packages only for fixed or linked release scopes",
      );
    }
    return updatePlanVersions(plan, packageKeys, () => override.version);
  }

  return updatePlanVersions(plan, packageKeys, (key) => {
    const current = currentVersion(ctx, key);
    const next = inc(current, override.bump);
    if (!next) throw new Error(`Cannot apply ${override.bump} bump to ${key}`);
    return next;
  });
}

function updatePlanVersions(
  plan: VersionPlan,
  packageKeys: ReadonlySet<string>,
  versionForKey: (key: string) => string,
): VersionPlan {
  if (plan.mode === "single") {
    const key = plan.packageKey;
    return packageKeys.has(key)
      ? { ...plan, version: versionForKey(key) }
      : { ...plan };
  }

  const packages = new Map(plan.packages);
  for (const key of packageKeys) {
    if (packages.has(key)) packages.set(key, versionForKey(key));
  }

  if (plan.mode === "fixed") {
    const firstKey = [...packageKeys].find((key) => packages.has(key));
    return {
      ...plan,
      version: firstKey ? versionForKey(firstKey) : plan.version,
      packages,
    };
  }

  return { ...plan, packages };
}

function currentVersion(ctx: PubmContext, key: string): string {
  const pkg = ctx.config.packages.find(
    (candidate) => packageKey(candidate) === key,
  );
  if (!pkg) throw new Error(`Unknown package key "${key}"`);
  return pkg.version;
}

function extractCommands(body: string): string[] {
  return body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^\/pubm\s+/i.test(line));
}

function timeValue(
  value: SlashCommandComment["createdAt"],
  commentIndex: number,
  commandIndex: number,
): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  if (typeof value === "string") return new Date(value).getTime();
  return commentIndex * 1000 + commandIndex;
}

function highestBump(
  bumps: readonly ReleasePrBumpOverride[],
): ReleasePrBumpOverride {
  const order: Record<ReleasePrBumpOverride, number> = {
    patch: 0,
    minor: 1,
    major: 2,
    prerelease: 3,
  };
  return [...bumps].sort((a, b) => order[b] - order[a])[0];
}
