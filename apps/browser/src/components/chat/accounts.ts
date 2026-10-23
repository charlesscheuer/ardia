import type { WebViewHandle } from "@ardia/ardiacore";
import { copyText } from "@ardia/shell";

export type ChatAccountId = "claude" | "chatgpt" | "codex";

export type ChatAccount = {
  id: ChatAccountId;
  name: string;
  service: string;
  home: string;
  host: string;
  loginPath: string;
  handOff?: (prompt: string) => string;
};

export const CHAT_ACCOUNTS: ChatAccount[] = [
  {
    id: "claude",
    name: "Claude",
    service: "Anthropic",
    home: "https://claude.ai/new",
    host: "claude.ai",
    loginPath: "/login",
    handOff: (prompt) => `https://claude.ai/new?q=${encodeURIComponent(prompt)}`,
  },
  {
    id: "chatgpt",
    name: "ChatGPT",
    service: "OpenAI",
    home: "https://chatgpt.com/",
    host: "chatgpt.com",
    loginPath: "/auth/login",
    handOff: (prompt) => `https://chatgpt.com/?prompt=${encodeURIComponent(prompt)}`,
  },
  {
    id: "codex",
    name: "Codex",
    service: "OpenAI",
    home: "https://chatgpt.com/codex",
    host: "chatgpt.com",
    loginPath: "/auth/login",
  },
];

export const accountById = (id: ChatAccountId): ChatAccount => CHAT_ACCOUNTS.find((a) => a.id === id) ?? CHAT_ACCOUNTS[0]!;

const handles = new Map<ChatAccountId, WebViewHandle>();

export function registerAccountWebView(id: ChatAccountId, handle: WebViewHandle | null) {
  if (handle) handles.set(id, handle);
  else handles.delete(id);
}

export const accountWebView = (id: ChatAccountId) => handles.get(id);

export type Delivery = "handed-off" | "typed" | "copied" | "failed";

const typeIntoSessionScript = (text: string) => `
(async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const visible = (el) => {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return rect.width > 40 && rect.height > 8 && style.visibility !== "hidden" && style.display !== "none";
  };
  let composer = null;
  for (let attempt = 0; attempt < 20 && !composer; attempt++) {
    const candidates = [...document.querySelectorAll('[contenteditable="true"], textarea')].filter(visible);
    composer = candidates.sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0] ?? null;
    if (!composer) await sleep(250);
  }
  if (!composer) return post("result", JSON.stringify("missing"));
  composer.focus();
  document.execCommand("selectAll", false);
  document.execCommand("delete", false);
  const inserted = document.execCommand("insertText", false, ${JSON.stringify(text)});
  if (!inserted) return post("result", JSON.stringify("missing"));
  await sleep(120);
  const buttons = [...document.querySelectorAll("button")].filter(visible);
  const send = buttons.find((b) => /send/i.test(b.getAttribute("aria-label") || b.textContent || ""));
  if (send && !send.disabled) {
    send.click();
    return post("result", JSON.stringify("sent"));
  }
  composer.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
  return post("result", JSON.stringify("sent"));
})()`;

export async function sendToAccount(account: ChatAccount, prompt: string, firstInThread: boolean): Promise<Delivery> {
  const handle = accountWebView(account.id);
  if (!handle) {
    copyText(prompt);
    return "copied";
  }
  if (firstInThread && account.handOff) {
    await handle.loadUrl(account.handOff(prompt));
    return "handed-off";
  }
  const result = await handle.evaluate<string>(typeIntoSessionScript(prompt)).catch(() => null);
  if (result === "sent") return "typed";
  copyText(prompt);
  return "copied";
}

const LAST_CODE_BLOCK = `
(() => {
  const blocks = [...document.querySelectorAll("pre")];
  const last = blocks[blocks.length - 1];
  return post("result", JSON.stringify(last ? last.innerText : ""));
})()`;

export async function pullLastCodeBlock(account: ChatAccount): Promise<string> {
  const handle = accountWebView(account.id);
  if (!handle) return "";
  return (await handle.evaluate<string>(LAST_CODE_BLOCK).catch(() => "")) ?? "";
}
