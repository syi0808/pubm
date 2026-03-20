export const name = "@pubm/core";

export function createLogger(prefix: string) {
  return (message: string) => console.log(`[${prefix}] ${message}`);
}
