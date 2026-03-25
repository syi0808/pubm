import { rm } from 'fs/promises';
import { join } from 'path';

try {
  await rm(join(import.meta.dirname, './bin/.pubm'));
} catch {}
