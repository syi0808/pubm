import process from "node:process";

export async function copyToClipboard(text: string): Promise<boolean> {
  const commands = getClipboardCommands();

  for (const cmd of commands) {
    try {
      const proc = Bun.spawn(cmd, {
        stdin: "pipe",
        stdout: "ignore",
        stderr: "ignore",
      });
      proc.stdin.write(text);
      proc.stdin.end();
      const exitCode = await proc.exited;
      if (exitCode === 0) return true;
    } catch {
      // Command not found or spawn failure, try next
    }
  }

  return false;
}

function getClipboardCommands(): string[][] {
  switch (process.platform) {
    case "darwin":
      return [["pbcopy"]];
    case "win32":
      return [["clip"]];
    default:
      return [["xclip", "-selection", "clipboard"], ["wl-copy"]];
  }
}
