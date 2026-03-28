import { AbstractError } from "../error.js";
import { t } from "../i18n/index.js";
import { exec } from "../utils/exec.js";

class VersionPrError extends AbstractError {
  name = "Version PR Error";
}

export interface CreateVersionPrOptions {
  branch: string;
  base: string;
  title: string;
  body: string;
  token: string;
  owner: string;
  repo: string;
  labels?: string[];
}

export interface CreateVersionPrResult {
  url: string;
  number: number;
}

export interface CloseVersionPrOptions {
  number: number;
  token: string;
  owner: string;
  repo: string;
}

export async function createVersionPr(
  options: CreateVersionPrOptions,
): Promise<CreateVersionPrResult> {
  try {
    return await createPrViaGhCli(options);
  } catch {
    return await createPrViaApi(options);
  }
}

export async function closeVersionPr(
  options: CloseVersionPrOptions,
): Promise<void> {
  try {
    await closePrViaGhCli(options);
  } catch {
    await closePrViaApi(options);
  }
}

async function createPrViaGhCli(
  options: CreateVersionPrOptions,
): Promise<CreateVersionPrResult> {
  const args = [
    "pr",
    "create",
    "--title",
    options.title,
    "--body",
    options.body,
    "--base",
    options.base,
    "--head",
    options.branch,
  ];

  if (options.labels && options.labels.length > 0) {
    args.push("--label", options.labels.join(","));
  }

  const { stdout } = await exec("gh", args, { throwOnError: true });
  const url = stdout.trim();

  const numberMatch = url.match(/\/pull\/(\d+)/);
  const number = numberMatch ? Number.parseInt(numberMatch[1], 10) : 0;

  return { url, number };
}

async function createPrViaApi(
  options: CreateVersionPrOptions,
): Promise<CreateVersionPrResult> {
  const response = await fetch(
    `https://api.github.com/repos/${options.owner}/${options.repo}/pulls`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${options.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({
        title: options.title,
        body: options.body,
        head: options.branch,
        base: options.base,
      }),
    },
  );

  if (!response.ok) {
    const errorBody = await response.text();
    throw new VersionPrError(
      t("error.versionPr.createFailed", {
        status: response.status,
        body: errorBody,
      }),
    );
  }

  const pr = (await response.json()) as {
    html_url: string;
    number: number;
  };

  // Add labels via separate API call if needed
  if (options.labels && options.labels.length > 0) {
    await fetch(
      `https://api.github.com/repos/${options.owner}/${options.repo}/issues/${pr.number}/labels`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify({ labels: options.labels }),
      },
    );
  }

  return { url: pr.html_url, number: pr.number };
}

async function closePrViaGhCli(options: CloseVersionPrOptions): Promise<void> {
  await exec("gh", ["pr", "close", `${options.number}`], {
    throwOnError: true,
  });
}

async function closePrViaApi(options: CloseVersionPrOptions): Promise<void> {
  const response = await fetch(
    `https://api.github.com/repos/${options.owner}/${options.repo}/pulls/${options.number}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${options.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({ state: "closed" }),
    },
  );

  if (!response.ok && response.status !== 404) {
    const errorBody = await response.text();
    throw new VersionPrError(
      t("error.versionPr.closeFailed", {
        status: response.status,
        body: errorBody,
      }),
    );
  }
}
