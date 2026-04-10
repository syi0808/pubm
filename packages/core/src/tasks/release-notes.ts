import type { ChangelogSection } from "../changelog/types.js";

export function renderReleaseNoteSections(
  sections: ChangelogSection[],
): string {
  if (sections.length === 0) return "";

  const parts: string[] = [];
  for (const section of sections) {
    if (section.category) {
      parts.push(`### ${section.category}\n\n${section.items.join("\n")}`);
    } else {
      parts.push(section.items.join("\n"));
    }
  }

  return parts.join("\n\n");
}
