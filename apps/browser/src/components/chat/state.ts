import { confirm } from "@ardia/shell";
import { create } from "zustand";
import { useBrowser } from "../../store/browser";
import { activeTabId } from "../../store/model";
import { closeSidePanel } from "../extensions/sidePanels";
import { accountById, pullLastCodeBlock, sendToAccount, type ChatAccountId, type Delivery } from "./accounts";
import { formatPicks, formatSelection } from "./agentationOutput";
import { diffCounts, lineDiff } from "./diff";
import { applyWorkingFileEdit } from "./files";
import type { PageContext, PickedElement, SelectionAttachment, WorkingFile } from "./types";

export type { ChatAccountId };

export type ChatMessage = {
  id: string;
  role: "user" | "system";
  text: string;
  account?: ChatAccountId;
  delivery?: Delivery | "sending";
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
};

type ChatStore = {
  windows: Record<string, WindowChat>;
};

const emptyChat = (): WindowChat => ({
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
});

export const useChat = create<ChatStore>()(() => ({ windows: {} }));

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

export function openChatPanel(windowId: string) {
  closeSidePanel(windowId);
  patch(windowId, { open: true });
}

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
  patch(windowId, { messages: [], picks: [], selection: null, proposedEdit: null, viewingSession: false });
}

export function setPageAttached(windowId: string, attached: boolean) {
  patch(windowId, { pageAttached: attached });
}

export function attachPick(windowId: string, pick: PickedElement) {
  const chat = chatOf(windowId);
  patch(windowId, { picks: [...chat.picks, pick] });
}

export function removePick(windowId: string, index: number) {
  const chat = chatOf(windowId);
  patch(windowId, { picks: chat.picks.filter((_, i) => i !== index) });
}

export function attachSelection(windowId: string, selection: SelectionAttachment) {
  patch(windowId, { selection });
  openChatPanel(windowId);
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

export function composePrompt(windowId: string, text: string): string {
  const chat = chatOf(windowId);
  const page = chat.pageAttached ? currentPage(windowId) : null;
  const blocks: string[] = [text];
  const context: string[] = [];
  if (page) context.push(`Page: ${page.title} (${page.url})`);
  if (chat.picks.length) context.push(formatPicks(chat.picks, page ?? { title: "", url: "", host: "" }));
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
  const chat = chatOf(windowId);
  const account = accountById(chat.account);
  const page = chat.pageAttached ? currentPage(windowId) : null;
  const firstInThread = !chat.messages.some((m) => m.role === "user");
  const prompt = composePrompt(windowId, text);
  const id = nextId();
  patch(windowId, {
    messages: [
      ...chat.messages,
      {
        id,
        role: "user",
        text,
        account: account.id,
        delivery: "sending",
        page: page ?? undefined,
        picks: chat.picks.length ? chat.picks : undefined,
        fileName: chat.workingFile?.name,
        at: Date.now(),
      },
    ],
    picks: [],
    selection: null,
  });
  const delivery = await sendToAccount(account, prompt, firstInThread).catch(() => "failed" as Delivery);
  const now = chatOf(windowId);
  patch(windowId, {
    messages: now.messages.map((m) => (m.id === id ? { ...m, delivery } : m)),
    ...(delivery === "handed-off" || delivery === "typed" ? { connected: { ...now.connected, [account.id]: true } } : {}),
  });
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
