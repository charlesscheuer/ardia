import { webviews } from "../../lib/webviews";
import { highlightScript, PICKER_SCRIPT } from "./pickerScript";
import type { PickedElement } from "./types";

const PICK_TIMEOUT_MS = 120000;

export async function pickElement(tabId: string): Promise<PickedElement | null> {
  const web = webviews.get(tabId);
  if (!web) return null;
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), PICK_TIMEOUT_MS));
  return Promise.race([web.evaluate<PickedElement>(PICKER_SCRIPT), timeout]);
}

export function flashElement(tabId: string, pick: PickedElement) {
  const web = webviews.get(tabId);
  if (web) void web.evaluate(highlightScript(pick));
}

export async function readSelection(tabId: string): Promise<string> {
  const web = webviews.get(tabId);
  if (!web) return "";
  return (await web.evaluate<string>(`post("result", JSON.stringify(String(getSelection() || "").trim().slice(0, 2000)))`)) ?? "";
}
