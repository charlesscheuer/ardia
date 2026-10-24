import { webviews } from "../../lib/webviews";
import { BRIDGE_URL } from "./bridge";
import type { PickedElement } from "./types";

const WAIT_MS = 15000;
const RETRY_MS = 3000;

export type InspectedInfo = {
  selector: string;
  tag?: string;
  id?: string;
  classes?: string[];
  path?: string;
  textContent?: string;
  name?: string;
  rect?: { x: number; y: number; width: number; height: number };
};

const PRESENT = `post("result", JSON.stringify(!!(window.__interfaceKit && window.__interfaceKit.toggle)))`;

const ACTIVATE = `(function () {
  var ik = window.__interfaceKit;
  if (!ik) return post("result", "false");
  var c = ik.controller;
  if (c) c.setActive(true);
  else ik.toggle();
  post("result", "true");
})()`;

const DEACTIVATE = `(function () {
  var c = window.__interfaceKit && window.__interfaceKit.controller;
  if (c && c.getState().isActive) c.setActive(false);
  post("result", "true");
})()`;

const PENDING_EDITS = `(function () {
  var ik = window.__interfaceKit;
  var pending = ik && ik.getPendingChanges ? ik.getPendingChanges() : null;
  post("result", JSON.stringify(pending && pending.count ? pending.prompt : ""));
})()`;

export type InspectorTab = "style" | "agent";

export type InspectorSnapshot = { key: string; info: InspectedInfo | null; tab: InspectorTab; count: number; items: string[] };

type WaitResult = { gone: true } | { timeout: true } | InspectorSnapshot;

const setTabScript = (tab: InspectorTab) => `(function () {
  var ik = window.__interfaceKit;
  if (ik && ik.setHostTab && ik.hostTab !== ${JSON.stringify(tab)}) ik.setHostTab(${JSON.stringify(tab)});
  post("result", "true");
})()`;

const waitScript = (last: Omit<InspectorSnapshot, "info">) => `(function () {
  var ik = window.__interfaceKit;
  var c = ik && ik.controller;
  if (!c) return post("result", JSON.stringify({ gone: true }));
  var last = ${JSON.stringify(last)};
  function describe(info) {
    if (!info) return null;
    var el = c.getSelectedElement && c.getSelectedElement();
    var rect = el && el.getBoundingClientRect ? el.getBoundingClientRect() : null;
    return {
      selector: info.selector,
      tag: info.tag,
      id: info.id,
      classes: info.classes,
      path: info.path,
      textContent: info.textContent,
      name: info.name,
      rect: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : undefined
    };
  }
  function snapshot() {
    var info = c.getState().selectedElement || null;
    var pending = ik.getPendingChanges ? ik.getPendingChanges() : { count: 0 };
    var items = (pending.items || []).map(function (item) { return typeof item === "string" ? item : item.summary || ""; }).filter(Boolean);
    return { key: info ? info.selector || "" : "", info: describe(info), tab: ik.hostTab || "style", count: pending.count || 0, items: items };
  }
  function changed(next) {
    return next.key !== last.key || next.tab !== last.tab || next.count !== last.count || next.items.join("\\n") !== last.items.join("\\n");
  }
  var now = snapshot();
  if (changed(now)) return post("result", JSON.stringify(now));
  var done = false;
  function check() {
    if (done) return;
    var next = snapshot();
    if (!changed(next)) return;
    finish(next);
  }
  function finish(value) {
    done = true;
    unsubscribe();
    window.removeEventListener("ik-host-tab", check);
    window.removeEventListener("ik-changes", check);
    clearTimeout(timer);
    post("result", JSON.stringify(value));
  }
  var unsubscribe = c.subscribe(check);
  window.addEventListener("ik-host-tab", check);
  window.addEventListener("ik-changes", check);
  var timer = setTimeout(function () { if (!done) finish({ timeout: true }); }, ${WAIT_MS});
})()`;

let source: Promise<string | null> | null = null;

function inspectorSource(): Promise<string | null> {
  source ??= fetch(`${BRIDGE_URL}/assets/ik.js`)
    .then((response) => (response.ok ? response.text() : null))
    .catch(() => null)
    .then((text) => {
      if (!text) source = null;
      return text;
    });
  return source;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function inspectedPick(info: InspectedInfo): PickedElement {
  const classes = info.classes ?? [];
  const label = info.name || `${info.tag ?? "element"}${info.id ? `#${info.id}` : ""}${classes.length ? `.${classes.slice(0, 2).join(".")}` : ""}`;
  return {
    element: label,
    elementPath: info.path ?? info.selector,
    fullPath: info.selector,
    boundingBox: info.rect ?? { x: 0, y: 0, width: 0, height: 0 },
    cssClasses: classes,
    computedStyles: {},
    nearbyText: (info.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 200),
  };
}

export async function inspectorEdits(tabId: string | undefined): Promise<string> {
  const web = tabId ? webviews.get(tabId) : undefined;
  if (!web) return "";
  return (await web.evaluate<string>(PENDING_EDITS).catch(() => "")) ?? "";
}

export type InspectorHandlers = {
  onSelect(pick: PickedElement | null): void;
  onAvailable(available: boolean): void;
  onTab(tab: InspectorTab): void;
  onChanges(count: number, items: string[]): void;
};

export async function setInspectorTab(tabId: string | undefined, tab: InspectorTab) {
  const web = tabId ? webviews.get(tabId) : undefined;
  if (web) await web.evaluate(setTabScript(tab)).catch(() => null);
}

export function startInspector(tabId: string, handlers: InspectorHandlers, currentTab: () => InspectorTab): () => void {
  let stopped = false;
  let activated = false;
  let last: Omit<InspectorSnapshot, "info"> = { key: "", tab: currentTab(), count: 0, items: [] };
  const run = async () => {
    while (!stopped) {
      const web = webviews.get(tabId);
      if (!web) {
        await sleep(RETRY_MS);
        continue;
      }
      const present = await web.evaluate<boolean>(PRESENT).catch(() => false);
      if (stopped) return;
      if (!present) {
        const code = await inspectorSource();
        if (stopped) return;
        if (!code) {
          handlers.onAvailable(false);
          await sleep(RETRY_MS);
          continue;
        }
        await web.evaluate(`window.__IK_HOST = "ardia";\n${code}\n;post("result", "true")`).catch(() => null);
        activated = false;
      }
      if (!activated) {
        await web.evaluate(ACTIVATE).catch(() => null);
        await web.evaluate(setTabScript(currentTab())).catch(() => null);
        last = { ...last, tab: currentTab() };
        activated = true;
        handlers.onAvailable(true);
      }
      if (stopped) return;
      const result = await Promise.race([web.evaluate<WaitResult>(waitScript(last)).catch(() => null), sleep(WAIT_MS + 2000).then(() => null)]);
      if (stopped) return;
      if (!result) {
        await sleep(RETRY_MS);
        continue;
      }
      if ("timeout" in result) continue;
      if ("gone" in result) {
        activated = false;
        continue;
      }
      if (result.key !== last.key) handlers.onSelect(result.info ? inspectedPick(result.info) : null);
      if (result.tab !== last.tab) handlers.onTab(result.tab);
      if (result.count !== last.count || result.items.join("\n") !== last.items.join("\n")) handlers.onChanges(result.count, result.items);
      last = { key: result.key, tab: result.tab, count: result.count, items: result.items };
    }
  };
  void run();
  return () => {
    stopped = true;
    void webviews.get(tabId)?.evaluate(DEACTIVATE).catch(() => null);
  };
}
