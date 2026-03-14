import { checkUpdateStatus, color } from "@pubm/core";

const LOGO = `              _
 _ __  _   _ | |__   _ __ ___
| '_ \\| | | || '_ \\ | '_ \` _ \\
| |_) | |_| || |_) || | | | | |
| .__/ \\__,_||_.__/ |_| |_| |_|
|_|`;

export function showSplash(version: string): void {
  const versionLine = `pubm v${version}`;
  const logoLines = LOGO.split("\n");
  const maxWidth = Math.max(...logoLines.map((l) => l.length));
  const paddedVersion = versionLine.padStart(maxWidth);

  process.stderr.write(`${color.dim(LOGO)}\n${color.bold(paddedVersion)}\n\n`);
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SPINNER_INTERVAL = 80;

function clearLine(): void {
  process.stderr.write("\r\x1b[K");
}

export async function showSplashWithUpdateCheck(
  version: string,
): Promise<void> {
  showSplash(version);

  let frameIndex = 0;
  const spinner = setInterval(() => {
    clearLine();
    process.stderr.write(
      ` ${SPINNER_FRAMES[frameIndex]} Checking for updates...`,
    );
    frameIndex = (frameIndex + 1) % SPINNER_FRAMES.length;
  }, SPINNER_INTERVAL);

  try {
    const status = await checkUpdateStatus();

    clearInterval(spinner);
    clearLine();

    if (status?.kind === "available") {
      process.stderr.write(
        ` ${color.green("✓")} Update available: ${status.current} → ${color.bold(status.latest)} (npm i -g pubm)\n\n`,
      );
    } else {
      process.stderr.write(` ${color.green("✓")} Ready\n\n`);
    }
  } catch {
    clearInterval(spinner);
    clearLine();
    process.stderr.write(` ${color.green("✓")} Ready\n\n`);
  }
}
