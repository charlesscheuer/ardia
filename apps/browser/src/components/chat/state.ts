import { confirm, readDocument, writeDocument } from "@ardia/shell";
import { create } from "zustand";
import { useBrowser } from "../../store/browser";
import { activeTabId } from "../../store/model";
import { closeSidePanel } from "../extensions/sidePanels";
import {
  accountById,
  handOffUrl,
  pullLastCodeBlock,
  readSession,
  sendToAccount,
  type ChatAccount,
  type ChatAccountId,
  type Delivery,
  type SessionReading,
} from "./accounts";
import { formatPicks, formatSelection } from "./agentationOutput";
import { bridgeComment, bridgeOnline, bridgeThreads, newAgentReplies, receiptTarget, sendToBridge, type BridgeStatus } from "./bridge";
import { diffCounts, lineDiff } from "./diff";
import { applyWorkingFileEdit } from "./files";
import { inspectorEdits } from "./inspector";
import type { PageContext, PickedElement, SelectionAttachment, WorkingFile } from "./types";

export type { ChatAccountId };

export type ChatMessage = {
  id: string;
  role: "user" | "system" | "agent";
  text: string;
  account?: ChatAccountId;
  delivery?: Delivery | "sending" | "bridged" | "unassigned";
  worker?: string;
  fresh?: boolean;
  streaming?: boolean;
  changeCount?: number;
  page?: PageContext;
  picks?: PickedElement[];
  fileName?: string;
  at: number;
};

export type WindowChat = {
  open: boolean;
  account: ChatAccountId;
  connected: Partial<Record<ChatAccountId, boolean>>;
  messages: ChatMessage[];
  pageAttached: boolean;
  picks: PickedElement[];
  selection: SelectionAttachment | null;
  workingFile: WorkingFile | null;
  proposedEdit: string | null;
  viewingSession: boolean;
  bridgeThreads: Record<string, BridgeThreadState>;
  inspected: PickedElement | null;
  inspector: "off" | "ready" | "unavailable";
  tab: ChatTab;
  pageKey: string;
  changes: PageChanges;
};

export type ChatTab = "style" | "agent";
export type PageChanges = { count: number; items: string[]; sentCount: number; excluded: boolean };

export type BridgeThreadState = { seen: string; url: string; workspace?: string; status: BridgeStatus | string };

type ChatStore = {
  windows: Record<string, WindowChat>;
};

export const emptyChat = (): WindowChat => ({
  open: false,
  account: "claude",
  connected: {},
  messages: [],
  pageAttached: true,
  picks: [],
  selection: null,
  workingFile: null,
  proposedEdit: null,
  viewingSession: false,
  bridgeThreads: {},
  inspected: null,
  inspector: "off",
  tab: "style",
  pageKey: "",
  changes: { count: 0, items: [], sentCount: 0, excluded: false },
});

export const useChat = create<ChatStore>()(() => ({ windows: {} }));

const THREADS_DOC = "chat-threads.json";
const THREAD_LIMIT = 120;
const MESSAGE_LIMIT = 200;
const SAVE_DELAY_MS = 600;

type SavedThread = { messages: ChatMessage[]; bridgeThreads: Record<string, BridgeThreadState>; at: number };

let savedThreads: Record<string, SavedThread> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | undefined;

function threads(): Record<string, SavedThread> {
  if (savedThreads) return savedThreads;
  try {
    savedThreads = JSON.parse(readDocument(THREADS_DOC) || "{}") as Record<string, SavedThread>;
  } catch {
    savedThreads = {};
  }
  return savedThreads;
}

function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = undefined;
    const kept = Object.entries(threads())
      .sort(([, a], [, b]) => b.at - a.at)
      .slice(0, THREAD_LIMIT);
    savedThreads = Object.fromEntries(kept);
    try {
      writeDocument(THREADS_DOC, JSON.stringify(savedThreads));
    } catch {}
  }, SAVE_DELAY_MS);
}

export function pageKey(url: string | undefined): string {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "file:") return `file://${parsed.pathname}`;
    return /^https?:$/.test(parsed.protocol) ? `${parsed.origin}${parsed.pathname}` : "";
  } catch {
    return "";
  }
}

export function hasThread(url: string | undefined) {
  const key = pageKey(url);
  return !!key && !!threads()[key]?.messages.some((m) => m.role === "user");
}

useChat.subscribe((state, previous) => {
  for (const [windowId, chat] of Object.entries(state.windows)) {
    const before = previous.windows[windowId];
    if (!chat.pageKey || (before && before.messages === chat.messages && before.bridgeThreads === chat.bridgeThreads && before.pageKey === chat.pageKey)) continue;
    if (!chat.messages.length) {
      if (threads()[chat.pageKey]) {
        delete threads()[chat.pageKey];
        scheduleSave();
      }
      continue;
    }
    threads()[chat.pageKey] = {
      messages: chat.messages.slice(-MESSAGE_LIMIT).map((m) => ({ ...m, fresh: false, streaming: false })),
      bridgeThreads: chat.bridgeThreads,
      at: Date.now(),
    };
    scheduleSave();
  }
});

let messageCounter = 0;
const nextId = () => `chat-${Date.now().toString(36)}-${(++messageCounter).toString(36)}`;

function patch(windowId: string, change: Partial<WindowChat>) {
  useChat.setState((s) => ({ windows: { ...s.windows, [windowId]: { ...(s.windows[windowId] ?? emptyChat()), ...change } } }));
}

function chatOf(windowId: string): WindowChat {
  return useChat.getState().windows[windowId] ?? emptyChat();
}

function pushMessage(windowId: string, message: Omit<ChatMessage, "id" | "at">) {
  const chat = chatOf(windowId);
  patch(windowId, { messages: [...chat.messages, { ...message, id: nextId(), at: Date.now() }] });
}

function currentPage(windowId: string): PageContext | null {
  const s = useBrowser.getState();
  const tabId = activeTabId(s, windowId);
  const tab = tabId ? s.tabs[tabId] : undefined;
  if (!tab?.url) return null;
  let host = "";
  try {
    host = new URL(tab.url).hostname;
  } catch {
    host = "";
  }
  return { title: tab.customTitle || tab.title || host || tab.url, url: tab.url, host };
}

export function showPage(windowId: string, url: string | undefined) {
  const key = pageKey(url);
  const chat = chatOf(windowId);
  if (key === chat.pageKey) return;
  const saved = key ? threads()[key] : undefined;
  patch(windowId, {
    pageKey: key,
    messages: saved?.messages ?? [],
    bridgeThreads: saved?.bridgeThreads ?? {},
    picks: [],
    inspected: null,
    selection: null,
    proposedEdit: null,
    changes: { count: 0, items: [], sentCount: 0, excluded: false },
  });
}

export function openChatPanel(windowId: string, tab?: ChatTab) {
  closeSidePanel(windowId);
  const url = currentPage(windowId)?.url;
  showPage(windowId, url);
  patch(windowId, { open: true, tab: tab ?? (hasThread(url) ? "agent" : "style") });
}

export function setChatTab(windowId: string, tab: ChatTab) {
  if (chatOf(windowId).tab !== tab) patch(windowId, { tab });
}

export function setPageChanges(windowId: string, count: number, items: string[]) {
  const changes = chatOf(windowId).changes;
  if (changes.count === count && changes.items.join("\n") === items.join("\n")) return;
  patch(windowId, {
    changes: { count, items, excluded: count === changes.count ? changes.excluded : false, sentCount: Math.min(changes.sentCount, count) },
  });
}

export function excludePageChanges(windowId: string) {
  patch(windowId, { changes: { ...chatOf(windowId).changes, excluded: true } });
}

export const changesPending = (chat: WindowChat) => chat.changes.count > 0 && chat.changes.count !== chat.changes.sentCount && !chat.changes.excluded;

export function closeChatPanel(windowId: string) {
  if (!useChat.getState().windows[windowId]?.open) return;
  patch(windowId, { open: false, viewingSession: false });
}

export function toggleChatPanel(windowId: string) {
  if (chatOf(windowId).open) closeChatPanel(windowId);
  else openChatPanel(windowId);
}

export function setAccount(windowId: string, account: ChatAccountId) {
  patch(windowId, { account, viewingSession: false });
}

export function markConnected(windowId: string, account: ChatAccountId) {
  const chat = chatOf(windowId);
  patch(windowId, { connected: { ...chat.connected, [account]: true }, viewingSession: false });
}

export function setViewingSession(windowId: string, viewing: boolean) {
  patch(windowId, { viewingSession: viewing });
}

export function newThread(windowId: string) {
  patch(windowId, { messages: [], picks: [], selection: null, proposedEdit: null, viewingSession: false, bridgeThreads: {} });
}

export function setPageAttached(windowId: string, attached: boolean) {
  patch(windowId, { pageAttached: attached });
}

export function attachPick(windowId: string, pick: PickedElement) {
  const chat = chatOf(windowId);
  patch(windowId, { picks: [...chat.picks, pick] });
}

export function setInspected(windowId: string, inspected: PickedElement | null) {
  patch(windowId, { inspected });
}

export function setInspectorStatus(windowId: string, inspector: WindowChat["inspector"]) {
  if (chatOf(windowId).inspector !== inspector) patch(windowId, { inspector });
}

const outgoingPicks = (chat: WindowChat) => (chat.inspected ? [chat.inspected, ...chat.picks] : chat.picks);

function activeTab(windowId: string) {
  return activeTabId(useBrowser.getState(), windowId) ?? undefined;
}

export function removePick(windowId: string, index: number) {
  const chat = chatOf(windowId);
  patch(windowId, { picks: chat.picks.filter((_, i) => i !== index) });
}

export function attachSelection(windowId: string, selection: SelectionAttachment) {
  patch(windowId, { selection });
  if (!chatOf(windowId).open) openChatPanel(windowId, "agent");
  else setChatTab(windowId, "agent");
}

export function clearSelection(windowId: string) {
  patch(windowId, { selection: null });
}

export function setWorkingFile(windowId: string, file: WorkingFile | null) {
  patch(windowId, { workingFile: file, proposedEdit: null });
}

export function setProposedEdit(windowId: string, text: string | null) {
  patch(windowId, { proposedEdit: text });
}

export function systemNote(windowId: string, text: string) {
  pushMessage(windowId, { role: "system", text });
}

const FILE_CONTEXT_LIMIT = 60000;

export function composePrompt(windowId: string, text: string, edits = ""): string {
  const chat = chatOf(windowId);
  const page = chat.pageAttached ? currentPage(windowId) : null;
  const picks = outgoingPicks(chat);
  const blocks: string[] = [text];
  const context: string[] = [];
  if (page) context.push(`Page: ${page.title} (${page.url})`);
  if (picks.length) context.push(formatPicks(picks, page ?? { title: "", url: "", host: "" }));
  if (edits) context.push(`Style edits made in InterfaceKit (apply these too):\n${edits}`);
  if (chat.selection) context.push(formatSelection(chat.selection));
  if (chat.workingFile) {
    const content =
      chat.workingFile.content.length > FILE_CONTEXT_LIMIT
        ? `${chat.workingFile.content.slice(0, FILE_CONTEXT_LIMIT)}\n… (truncated)`
        : chat.workingFile.content;
    context.push(`Working file: ${chat.workingFile.name}\nWhen you propose an edit to this file, reply with the complete revised file in one code block.\n\n\`\`\`\n${content}\n\`\`\``);
  }
  if (context.length) blocks.push(`--- Context ---\n${context.join("\n\n")}`);
  return blocks.join("\n\n");
}

export async function sendMessage(windowId: string, rawText: string) {
  const text = rawText.trim();
  if (!text) return;
  const pending = changesPending(chatOf(windowId));
  const changeCount = pending ? chatOf(windowId).changes.count : 0;
  const edits = pending ? await inspectorEdits(activeTab(windowId)) : "";
  const chat = chatOf(windowId);
  const account = accountById(chat.account);
  const page = chat.pageAttached ? currentPage(windowId) : null;
  const firstInThread = !chat.messages.some((m) => m.role === "user");
  if (changeCount) patch(windowId, { changes: { ...chat.changes, sentCount: changeCount } });
  if (account.kind === "bridge") return sendToLocalAgent(windowId, text, page, edits, changeCount);
  const picks = outgoingPicks(chat);
  const prompt = composePrompt(windowId, text, edits);
  const before = await readSession(account);
  const handOff = handOffUrl(account, prompt, firstInThread);
  const id = nextId();
  patch(windowId, {
    messages: [
      ...chatOf(windowId).messages,
      {
        id,
        role: "user",
        text,
        account: account.id,
        delivery: "sending",
        changeCount: changeCount || undefined,
        page: page ?? undefined,
        picks: picks.length ? picks : undefined,
        fileName: chat.workingFile?.name,
        at: Date.now(),
      },
    ],
    picks: [],
    inspected: null,
    selection: null,
  });
  const delivery = await sendToAccount(account, prompt, firstInThread).catch(() => "failed" as Delivery);
  const now = chatOf(windowId);
  patch(windowId, {
    messages: now.messages.map((m) => (m.id === id ? { ...m, delivery } : m)),
    ...(delivery === "handed-off" || delivery === "typed" ? { connected: { ...now.connected, [account.id]: true } } : {}),
  });
  if (delivery === "handed-off" || delivery === "typed") void watchReply(windowId, account, before, delivery === "handed-off" ? handOff : null);
}

const REPLY_POLL_MS = 150;
const REPLY_SETTLE_MS = 1200;
const REPLY_TIMEOUT_MS = 5 * 60 * 1000;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function upsertAgentMessage(windowId: string, id: string | null, account: ChatAccountId, text: string, streaming: boolean) {
  const chat = chatOf(windowId);
  if (id && chat.messages.some((m) => m.id === id)) {
    patch(windowId, { messages: chat.messages.map((m) => (m.id === id ? { ...m, text, streaming } : m)) });
    return id;
  }
  const fresh = nextId();
  patch(windowId, { messages: [...chat.messages, { id: fresh, role: "agent", text, account, fresh: true, streaming, at: Date.now() }] });
  return fresh;
}

async function watchReply(windowId: string, account: ChatAccount, before: SessionReading | null, handOff: string | null) {
  const deadline = Date.now() + REPLY_TIMEOUT_MS;
  let id: string | null = null;
  let last = "";
  let changedAt = Date.now();
  while (Date.now() < deadline) {
    await sleep(REPLY_POLL_MS);
    const now = await readSession(account);
    if (!now) continue;
    if (handOff && (now.href === before?.href || now.href === handOff)) continue;
    if (now.count <= (handOff ? 0 : (before?.count ?? 0)) || !now.text) continue;
    if (now.text !== last) {
      last = now.text;
      changedAt = Date.now();
      id = upsertAgentMessage(windowId, id, account.id, now.text, true);
    }
    if (!now.streaming && Date.now() - changedAt > REPLY_SETTLE_MS) break;
  }
  if (id) upsertAgentMessage(windowId, id, account.id, last, false);
}

function liveBridgeThread(chat: WindowChat, page: PageContext | null) {
  const entry = Object.entries(chat.bridgeThreads)
    .filter(([, t]) => t.url === (page?.url ?? ""))
    .sort(([, a], [, b]) => (a.seen < b.seen ? 1 : -1))[0];
  return entry ? { id: Number(entry[0]), workspace: entry[1].workspace } : undefined;
}

async function sendToLocalAgent(windowId: string, text: string, page: PageContext | null, edits: string, changeCount: number) {
  const chat = chatOf(windowId);
  const picks = outgoingPicks(chat);
  const id = nextId();
  const timestamp = new Date().toISOString();
  const comment = bridgeComment({
    text,
    picks,
    selection: chat.selection,
    pendingEdits: edits,
    page,
    workingFile: chat.workingFile,
    thread: liveBridgeThread(chat, page),
    requestId: id,
    timestamp,
  });
  patch(windowId, {
    messages: [
      ...chat.messages,
      {
        id,
        role: "user",
        text,
        account: "local",
        delivery: "sending",
        changeCount: changeCount || undefined,
        page: page ?? undefined,
        picks: picks.length ? picks : undefined,
        fileName: chat.workingFile?.name,
        at: Date.now(),
      },
    ],
    picks: [],
    inspected: null,
    selection: null,
  });
  const receipt = await sendToBridge(comment);
  const now = chatOf(windowId);
  const target = receipt ? receiptTarget(receipt) : null;
  const delivery: ChatMessage["delivery"] = !receipt ? "failed" : target ? "bridged" : "unassigned";
  patch(windowId, {
    messages: now.messages.map((m) => (m.id === id ? { ...m, delivery, worker: target ?? undefined } : m)),
    connected: { ...now.connected, local: !!receipt },
    ...(receipt
      ? {
          bridgeThreads: {
            ...now.bridgeThreads,
            [receipt.threadId]: { seen: timestamp, url: comment.url, workspace: comment.workspace, status: "working" },
          },
        }
      : {}),
  });
  if (!receipt) systemNote(windowId, "The InterfaceKit bridge isn't running on :4923. Open OpenInterface Dev, or run node ~/interface-kit/bridge/ik-bridge.js.");
}

export async function checkLocalAgent(windowId: string) {
  const online = await bridgeOnline();
  const chat = chatOf(windowId);
  if (!!chat.connected.local !== online) patch(windowId, { connected: { ...chat.connected, local: online } });
  return online;
}

export async function pollLocalAgent(windowId: string) {
  if (!Object.keys(chatOf(windowId).bridgeThreads).length) return;
  const threads = await bridgeThreads();
  const chat = chatOf(windowId);
  const tracked = { ...chat.bridgeThreads };
  const replies: ChatMessage[] = [];
  for (const thread of threads) {
    const state = tracked[thread.id];
    if (!state) continue;
    const fresh = newAgentReplies(thread, state.seen);
    for (const reply of fresh) replies.push({ id: nextId(), role: "agent", text: reply.text, account: "local", fresh: true, at: Date.parse(reply.ts) || Date.now() });
    const seen = fresh.reduce((latest, reply) => (reply.ts > latest ? reply.ts : latest), state.seen);
    if (seen !== state.seen || thread.status !== state.status || thread.workspace !== state.workspace)
      tracked[thread.id] = { ...state, seen, status: thread.status, workspace: thread.workspace };
  }
  const changed = Object.keys(tracked).some((key) => tracked[key] !== chat.bridgeThreads[key]);
  if (!replies.length && !changed) return;
  patch(windowId, { messages: [...chat.messages, ...replies], bridgeThreads: tracked });
}

export function settleMessage(windowId: string, id: string) {
  const chat = chatOf(windowId);
  if (!chat.messages.some((m) => m.id === id && m.fresh)) return;
  patch(windowId, { messages: chat.messages.map((m) => (m.id === id ? { ...m, fresh: false } : m)) });
}

export function localAgentWorking(chat: WindowChat) {
  return Object.values(chat.bridgeThreads).some((t) => t.status === "working");
}

export async function pullProposedEdit(windowId: string) {
  const chat = chatOf(windowId);
  if (!chat.workingFile) return;
  const content = await pullLastCodeBlock(accountById(chat.account));
  if (content) patch(windowId, { proposedEdit: content });
  else systemNote(windowId, "No code block found in the session yet. Ask for the revised file in one code block, or paste it into the proposed edit.");
}

export async function applyProposedEdit(windowId: string) {
  const chat = chatOf(windowId);
  const file = chat.workingFile;
  const proposed = chat.proposedEdit;
  if (!file || proposed == null) return;
  const counts = diffCounts(lineDiff(file.content, proposed));
  const { confirmed } = await confirm({
    title: `Apply edit to ${file.name}?`,
    message: `+${counts.added} / −${counts.removed} lines. The file on disk will be overwritten.`,
    confirmTitle: "Apply",
    windowId,
  });
  if (!confirmed) return;
  const ok = await applyWorkingFileEdit(file, proposed).catch(() => false);
  if (ok) {
    patch(windowId, { workingFile: { ...file, content: proposed }, proposedEdit: null });
    systemNote(windowId, `Applied the edit to ${file.name}.`);
  } else {
    systemNote(windowId, `Couldn't write ${file.name}. The file may have moved or not be writable.`);
  }
}
