import { formatPicks, formatSelection } from "./agentationOutput";
import type { PageContext, PickedElement, SelectionAttachment, WorkingFile } from "./types";

export const BRIDGE_URL = "http://127.0.0.1:4923";
const BRIDGE_TIMEOUT_MS = 4000;
const BRIDGE_WORKER = "opencode";

export type BridgeElement = {
  selector: string;
  tag: string;
  id?: string;
  classes: string[];
  path: string;
  textContent?: string;
  name: string;
};

export type BridgeComment = {
  requestId: string;
  source: "extension";
  comment: string;
  element: BridgeElement;
  anchor: { selector: string };
  url: string;
  title: string;
  timestamp: string;
  workerHint: string;
  pendingEdits?: string;
  threadId?: number;
  workspace?: string;
};

export type BridgeStatus = "working" | "done" | "question";

export type BridgeThread = {
  id: number;
  url: string;
  workspace?: string;
  status: BridgeStatus | string;
  messages: { role: "user" | "agent"; text: string; ts: string }[];
};

export type BridgeReceipt = { threadId: number; worker: string | null; mode?: string };

export function bridgeElement(pick: PickedElement | undefined, page: PageContext | null): BridgeElement {
  if (!pick) return { selector: "body", tag: "body", classes: [], path: "html > body", name: page?.title || page?.host || "page" };
  const last = pick.fullPath.split(" > ").pop() ?? "";
  const id = last.match(/#([\w-]+)/)?.[1];
  return {
    selector: pick.fullPath,
    tag: last.match(/^[a-z][\w-]*/i)?.[0] ?? "div",
    ...(id ? { id } : {}),
    classes: pick.cssClasses,
    path: pick.elementPath,
    ...(pick.selectedText || pick.nearbyText ? { textContent: pick.selectedText || pick.nearbyText } : {}),
    name: pick.element,
  };
}

const filePath = (url: string) => {
  try {
    return decodeURIComponent(new URL(url).pathname);
  } catch {
    return url;
  }
};

export function bridgeComment(input: {
  text: string;
  picks: PickedElement[];
  selection: SelectionAttachment | null;
  page: PageContext | null;
  workingFile: WorkingFile | null;
  pendingEdits?: string;
  thread?: { id: number; workspace?: string };
  requestId: string;
  timestamp: string;
}): BridgeComment {
  const page = input.page;
  const context = [
    input.picks.length ? formatPicks(input.picks, page ?? { title: "", url: "", host: "" }) : "",
    input.selection ? formatSelection(input.selection) : "",
    input.workingFile ? `Working file: ${filePath(input.workingFile.url)}` : "",
  ].filter(Boolean);
  const element = bridgeElement(input.picks[0], page);
  return {
    requestId: input.requestId,
    source: "extension",
    comment: [input.text, ...context].join("\n\n"),
    element,
    anchor: { selector: element.selector },
    url: page?.url ?? "",
    title: page?.title ?? "",
    timestamp: input.timestamp,
    workerHint: BRIDGE_WORKER,
    ...(input.pendingEdits ? { pendingEdits: input.pendingEdits } : {}),
    ...(input.thread ? { threadId: input.thread.id, ...(input.thread.workspace ? { workspace: input.thread.workspace } : {}) } : {}),
  };
}

export function receiptTarget(receipt: BridgeReceipt): string | null {
  if (receipt.worker) return receipt.worker;
  if (receipt.mode === "aether") return "Aether";
  if (receipt.mode === "markdown") return "the feedback file";
  if (receipt.mode === "agent") return "the bridge's agent";
  return null;
}

export function newAgentReplies(thread: BridgeThread, after: string) {
  return thread.messages.filter((m) => m.role === "agent" && m.ts > after);
}

async function call<T>(path: string, body?: unknown): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BRIDGE_TIMEOUT_MS);
  try {
    const response = await fetch(`${BRIDGE_URL}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function bridgeOnline(): Promise<boolean> {
  return !!(await call<{ version: number }>("/version"));
}

export async function sendToBridge(comment: BridgeComment): Promise<BridgeReceipt | null> {
  const receipt = await call<{ ok: boolean; threadId: number; worker?: string | null; mode?: string }>("/comments", comment);
  if (receipt?.ok) return { threadId: receipt.threadId, worker: receipt.worker ?? null, ...(receipt.mode ? { mode: receipt.mode } : {}) };
  const delivered = await call<{ threadId: number }>(`/comments/${comment.requestId}`);
  return delivered ? { threadId: delivered.threadId, worker: null } : null;
}

export async function bridgeThreads(): Promise<BridgeThread[]> {
  return (await call<BridgeThread[]>("/threads")) ?? [];
}
