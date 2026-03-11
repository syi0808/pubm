import path from "node:path";

export default {
  branch: path.basename(import.meta.dirname),
  contents: import.meta.url,
  registries: ["npm"],
} as const;
