import { color } from "@pubm/core";

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
