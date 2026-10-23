import type { PageContext, PickedElement, SelectionAttachment } from "./types";

function stylesBlock(styles: Record<string, string>): string {
  const entries = Object.entries(styles);
  if (!entries.length) return "";
  return `\nStyles: ${entries.map(([key, value]) => `${key}: ${value}`).join("; ")}`;
}

export function formatPickedElement(pick: PickedElement, index: number): string {
  const box = pick.boundingBox;
  const lines = [
    `### ${index + 1}. ${pick.element}`,
    `Path: ${pick.elementPath}`,
    `Full path: ${pick.fullPath}`,
    `Position: ${Math.round(box.width)}×${Math.round(box.height)} at (${Math.round(box.x)}, ${Math.round(box.y)})`,
  ];
  if (pick.cssClasses.length) lines.push(`Classes: ${pick.cssClasses.join(" ")}`);
  const styles = stylesBlock(pick.computedStyles);
  if (styles) lines.push(styles.trimStart());
  if (pick.reactComponents?.length) lines.push(`React: ${pick.reactComponents.join(" > ")}`);
  if (pick.sourceFile) lines.push(`Source: ${pick.sourceFile}`);
  if (pick.selectedText) lines.push(`Selected text: "${pick.selectedText}"`);
  else if (pick.nearbyText) lines.push(`Nearby text: "${pick.nearbyText}"`);
  return lines.join("\n");
}

export function formatPicks(picks: PickedElement[], page: PageContext): string {
  const path = page.host || page.url;
  return [`## Page Feedback: ${path}`, `Page: ${page.title} (${page.url})`, "", ...picks.map((pick, i) => formatPickedElement(pick, i))].join("\n");
}

export function formatSelection(selection: SelectionAttachment): string {
  return [`Selected text on the page:`, `"${selection.text}"`, selection.elementPath ? `From: ${selection.elementPath}` : ""].filter(Boolean).join("\n");
}
