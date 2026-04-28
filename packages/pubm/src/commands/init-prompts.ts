import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  detectWorkspace,
  discoverPackages,
  t,
  type WorkspaceInfo,
} from "@pubm/core";
import { prompt } from "@pubm/runner";

export interface PackageDetectionResult {
  isMonorepo: boolean;
  workspaces: WorkspaceInfo[];
  packages: Array<{ name: string; path: string }>;
}

export interface InitResult {
  packages: string[];
  branch: string;
  versioning: "independent" | "fixed";
  changelog: boolean;
  changelogFormat: "default" | "github";
  releaseDraft: boolean;
  changesets: boolean;
  ci: boolean;
  isMonorepo: boolean;
}

export const INIT_DEFAULTS = {
  versioning: "independent" as const,
  branch: "main",
  changelog: true,
  changelogFormat: "default" as const,
  releaseDraft: true,
};

export function detectDefaultBranch(cwd: string): string {
  try {
    const ref = execSync("git symbolic-ref refs/remotes/origin/HEAD", {
      cwd,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    return ref.replace("refs/remotes/origin/", "");
  } catch {
    return "main";
  }
}

export async function detectPackages(
  cwd: string,
): Promise<PackageDetectionResult> {
  const workspaces = detectWorkspace(cwd);
  const isMonorepo = workspaces.length > 0;

  if (!isMonorepo) {
    const pkgPath = path.join(cwd, "package.json");
    let name = path.basename(cwd);

    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      name = pkg.name ?? name;
    }

    return {
      isMonorepo: false,
      workspaces: [],
      packages: [{ name, path: "." }],
    };
  }

  const discovered = await discoverPackages({ cwd });
  const packages = discovered.map((pkg) => ({
    name: pkg.name,
    path: path.relative(cwd, pkg.path).replace(/\\/g, "/"),
  }));

  return { isMonorepo, workspaces, packages };
}

export async function promptPackages(
  detected: PackageDetectionResult,
): Promise<string[]> {
  if (!detected.isMonorepo) {
    const confirmed = await prompt<boolean>({
      type: "confirm",
      message: t("prompt.init.confirmPackage", {
        name: detected.packages[0].name,
      }),
    });
    if (!confirmed) return [];
    return [detected.packages[0].path];
  }

  const choices = detected.packages.map((pkg) => ({
    name: pkg.path,
    message: `${pkg.path} (${pkg.name})`,
    value: pkg.path,
  }));

  const selected = await prompt<string[]>({
    type: "multiselect",
    message: t("prompt.init.selectPackages"),
    choices,
    initial: detected.packages.map((_, i) => i),
  });

  return selected;
}

export async function promptBranch(cwd: string): Promise<string> {
  const detected = detectDefaultBranch(cwd);

  const choice = await prompt<string>({
    type: "select",
    message: "Release branch",
    choices: [
      {
        name: detected,
        message: t("prompt.init.branchDetected", { branch: detected }),
      },
      { name: "__other__", message: t("prompt.init.branchOther") },
    ],
  });

  if (choice === "__other__") {
    const branch = await prompt<string>({
      type: "input",
      message: t("prompt.init.enterBranch"),
      validate: (value) =>
        String(value ?? "").trim().length > 0 || t("error.init.branchEmpty"),
    });
    return branch.trim();
  }

  return choice;
}

export async function promptVersioning(): Promise<"independent" | "fixed"> {
  const versioning = await prompt<"independent" | "fixed">({
    type: "select",
    message: t("prompt.init.versioning"),
    choices: [
      {
        name: "independent",
        message: t("prompt.init.versioningIndependent"),
      },
      {
        name: "fixed",
        message: t("prompt.init.versioningFixed"),
      },
    ],
  });

  return versioning;
}

export async function promptChangelog(): Promise<{
  enabled: boolean;
  format: "default" | "github";
}> {
  const enabled = await prompt<boolean>({
    type: "confirm",
    message: t("prompt.init.changelog"),
    initial: true,
  });

  if (!enabled) return { enabled: false, format: "default" };

  const format = await prompt<"default" | "github">({
    type: "select",
    message: t("prompt.init.changelogFormat"),
    choices: [
      { name: "github", message: t("prompt.init.changelogGithub") },
      { name: "default", message: t("prompt.init.changelogDefault") },
    ],
  });

  return { enabled, format };
}

export async function promptGithubRelease(): Promise<boolean> {
  const enabled = await prompt<boolean>({
    type: "confirm",
    message: t("prompt.init.releaseDraft"),
    initial: true,
  });
  return enabled;
}

export async function promptChangesets(): Promise<boolean> {
  const enabled = await prompt<boolean>({
    type: "confirm",
    message: t("prompt.init.changesets"),
    initial: true,
  });
  return enabled;
}

export async function promptCI(): Promise<boolean> {
  const enabled = await prompt<boolean>({
    type: "confirm",
    message: t("prompt.init.ciWorkflow"),
    initial: true,
  });
  return enabled;
}

export async function promptSkills(): Promise<boolean> {
  const enabled = await prompt<boolean>({
    type: "confirm",
    message: t("prompt.init.skills"),
  });
  return enabled;
}

export async function promptOverwriteConfig(): Promise<boolean> {
  const overwrite = await prompt<boolean>({
    type: "confirm",
    message: t("prompt.init.overwrite"),
  });
  return overwrite;
}

export function shouldCreateConfig(
  result: InitResult,
  detectedBranch: string,
): boolean {
  if (result.isMonorepo) return true;

  const defaults = { ...INIT_DEFAULTS, branch: detectedBranch };

  if (result.versioning !== defaults.versioning) return true;
  if (result.branch !== defaults.branch) return true;
  if (result.changelog !== defaults.changelog) return true;
  if (result.changelogFormat !== defaults.changelogFormat) return true;
  if (result.releaseDraft !== defaults.releaseDraft) return true;

  return false;
}

export function buildConfigContent(result: InitResult): string {
  const fields: string[] = [];

  if (result.isMonorepo && result.packages.length > 0) {
    const pkgEntries = result.packages
      .map((p) => `    { path: "${p}" }`)
      .join(",\n");
    fields.push(`  packages: [\n${pkgEntries},\n  ]`);
  }

  if (result.versioning !== INIT_DEFAULTS.versioning) {
    fields.push(`  versioning: "${result.versioning}"`);
  }
  if (result.branch !== INIT_DEFAULTS.branch) {
    fields.push(`  branch: "${result.branch}"`);
  }
  if (!result.changelog) {
    fields.push(`  changelog: false`);
  }
  if (
    result.changelog &&
    result.changelogFormat !== INIT_DEFAULTS.changelogFormat
  ) {
    fields.push(`  changelogFormat: "${result.changelogFormat}"`);
  }
  if (result.releaseDraft !== INIT_DEFAULTS.releaseDraft) {
    fields.push(`  releaseDraft: ${result.releaseDraft}`);
  }

  return `import { defineConfig } from "@pubm/core";

export default defineConfig({
${fields.join(",\n")}${fields.length > 0 ? "," : ""}
});
`;
}
