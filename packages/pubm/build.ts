import { rm } from "node:fs/promises";
import { join } from "node:path";

try {
  await rm(join(import.meta.dirname, "./bin/.pubm"));
} catch {}
