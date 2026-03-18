import { SecureStore } from "./secure-store.js";

const GITHUB_TOKEN_KEY = "github-token";

export type GitHubTokenResult = {
  token: string;
  source: "env" | "store" | "prompt";
} | null;

export function resolveGitHubToken(): GitHubTokenResult {
  // 1. Environment variable
  const envToken = process.env.GITHUB_TOKEN;
  if (envToken) {
    return { token: envToken, source: "env" };
  }

  // 2. SecureStore (OS keyring → encrypted Db)
  const store = new SecureStore();
  const storedToken = store.get(GITHUB_TOKEN_KEY);
  if (storedToken) {
    return { token: storedToken, source: "store" };
  }

  // 3. No token found
  return null;
}

export function saveGitHubToken(token: string): void {
  const store = new SecureStore();
  store.set(GITHUB_TOKEN_KEY, token);
}
