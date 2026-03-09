import process from "node:process";

export async function openUrl(url: string): Promise<void> {
  const command =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "cmd"
        : "xdg-open";

  const args = process.platform === "win32" ? ["/c", "start", url] : [url];

  Bun.spawn([command, ...args], {
    stdout: "ignore",
    stderr: "ignore",
  });
}
