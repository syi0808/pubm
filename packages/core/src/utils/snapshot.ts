export interface SnapshotOptions {
  tag?: string;
  baseVersion: string;
  template?: string;
  commit?: string;
}

function formatTimestamp(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  const seconds = String(date.getUTCSeconds()).padStart(2, "0");
  return `${year}${month}${day}T${hours}${minutes}${seconds}`;
}

export function generateSnapshotVersion(options: SnapshotOptions): string {
  const tag = options.tag ?? "snapshot";
  const base = options.baseVersion;
  const now = new Date();
  const timestamp = formatTimestamp(now);

  if (options.template) {
    const suffix = options.template
      .replace(/\{tag\}/g, tag)
      .replace(/\{timestamp\}/g, timestamp)
      .replace(/\{commit\}/g, options.commit ?? "");
    return `${base}-${suffix}`;
  }

  return `${base}-${tag}-${timestamp}`;
}
