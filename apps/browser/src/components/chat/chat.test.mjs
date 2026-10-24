import assert from "node:assert/strict";
import { test } from "node:test";

const { formatPicks, formatSelection } = await import("./agentationOutput.ts");
const { lineDiff, diffCounts } = await import("./diff.ts");
const { bridgeComment, bridgeElement, newAgentReplies, receiptTarget } = await import("./bridge.ts");
const { inspectedPick } = await import("./inspector.ts");

const pick = {
  element: 'button.primary "Save"',
  elementPath: "html > body > div.app > button.primary",
  fullPath: "html > body > div#root > div.app > button.primary",
  boundingBox: { x: 10.2, y: 20.6, width: 120.4, height: 32 },
  cssClasses: ["primary", "large"],
  computedStyles: { display: "flex", color: "rgb(0, 0, 0)" },
  nearbyText: "Save your changes",
  reactComponents: ["App", "SaveButton"],
  sourceFile: "src/Save.tsx:42",
};

test("formatPicks produces the agentation page-feedback shape", () => {
  const out = formatPicks([pick], { title: "Settings", url: "https://example.com/settings", host: "example.com" });
  assert.match(out, /^## Page Feedback: example\.com/);
  assert.match(out, /Page: Settings \(https:\/\/example\.com\/settings\)/);
  assert.match(out, /### 1\. button\.primary "Save"/);
  assert.match(out, /Path: html > body > div\.app > button\.primary/);
  assert.match(out, /Full path: html > body > div#root > div\.app > button\.primary/);
  assert.match(out, /Position: 120×32 at \(10, 21\)/);
  assert.match(out, /Classes: primary large/);
  assert.match(out, /Styles: display: flex; color: rgb\(0, 0, 0\)/);
  assert.match(out, /React: App > SaveButton/);
  assert.match(out, /Source: src\/Save\.tsx:42/);
  assert.match(out, /Nearby text: "Save your changes"/);
});

test("formatPicks prefers selected text over nearby text", () => {
  const out = formatPicks([{ ...pick, selectedText: "chosen words" }], { title: "T", url: "https://a.test/", host: "a.test" });
  assert.match(out, /Selected text: "chosen words"/);
  assert.doesNotMatch(out, /Nearby text/);
});

test("formatSelection quotes the text and names its element when known", () => {
  assert.equal(formatSelection({ text: "hello", elementPath: "html > body > p" }), 'Selected text on the page:\n"hello"\nFrom: html > body > p');
  assert.equal(formatSelection({ text: "hello", elementPath: "" }), 'Selected text on the page:\n"hello"');
});

test("lineDiff marks additions and removals around shared lines", () => {
  const lines = lineDiff("a\nb\nc", "a\nx\nc\nd");
  assert.deepEqual(
    lines.map((l) => `${l.kind}:${l.text}`),
    ["same:a", "remove:b", "add:x", "same:c", "add:d"],
  );
  assert.deepEqual(diffCounts(lines), { added: 2, removed: 1 });
});

test("lineDiff of identical text is all same", () => {
  const lines = lineDiff("one\ntwo", "one\ntwo");
  assert.ok(lines.every((l) => l.kind === "same"));
  assert.deepEqual(diffCounts(lines), { added: 0, removed: 0 });
});

const page = { title: "Settings", url: "http://localhost:3000/settings", host: "localhost" };

test("bridgeElement turns a pick into the InterfaceKit element shape", () => {
  assert.deepEqual(bridgeElement({ ...pick, fullPath: "html > body > div#root > button#save.primary" }, page), {
    selector: "html > body > div#root > button#save.primary",
    tag: "button",
    id: "save",
    classes: ["primary", "large"],
    path: "html > body > div.app > button.primary",
    textContent: "Save your changes",
    name: 'button.primary "Save"',
  });
});

test("bridgeElement falls back to the page body without a pick", () => {
  assert.deepEqual(bridgeElement(undefined, page), { selector: "body", tag: "body", classes: [], path: "html > body", name: "Settings" });
});

test("bridgeComment sends the message with agentation context, routed like an extension comment", () => {
  const comment = bridgeComment({
    text: "Make this button blue",
    picks: [pick],
    selection: null,
    page,
    workingFile: { url: "file:///Users/me/app/src/Save.tsx", name: "Save.tsx", content: "" },
    requestId: "r1",
    timestamp: "2026-10-23T10:00:00.000Z",
  });
  assert.equal(comment.source, "extension");
  assert.equal(comment.workerHint, "opencode");
  assert.equal(comment.url, page.url);
  assert.equal(comment.element.selector, pick.fullPath);
  assert.deepEqual(comment.anchor, { selector: pick.fullPath });
  assert.match(comment.comment, /^Make this button blue\n\n## Page Feedback: localhost/);
  assert.match(comment.comment, /Working file: \/Users\/me\/app\/src\/Save\.tsx$/);
  assert.equal(comment.threadId, undefined);
});

test("bridgeComment continues a bridge thread in its worktree", () => {
  const comment = bridgeComment({ text: "Also the border", picks: [], selection: null, page, workingFile: null, thread: { id: 7, workspace: "/w/tree" }, requestId: "r2", timestamp: "t" });
  assert.equal(comment.threadId, 7);
  assert.equal(comment.workspace, "/w/tree");
  assert.equal(comment.comment, "Also the border");
});

test("newAgentReplies keeps only agent messages after the last one seen", () => {
  const thread = {
    id: 1,
    url: page.url,
    status: "done",
    messages: [
      { role: "agent", text: "old", ts: "2026-10-23T09:00:00.000Z" },
      { role: "user", text: "ask", ts: "2026-10-23T10:00:00.000Z" },
      { role: "agent", text: "done", ts: "2026-10-23T10:05:00.000Z" },
    ],
  };
  assert.deepEqual(newAgentReplies(thread, "2026-10-23T10:00:00.000Z").map((m) => m.text), ["done"]);
});

test("receiptTarget names where the bridge sent a message", () => {
  assert.equal(receiptTarget({ threadId: 1, worker: "opencode" }), "opencode");
  assert.equal(receiptTarget({ threadId: 1, worker: null, mode: "aether" }), "Aether");
  assert.equal(receiptTarget({ threadId: 1, worker: null }), null);
});

test("inspectedPick turns an InterfaceKit selection into a chat reference", () => {
  const out = inspectedPick({
    selector: "main > h1.title",
    tag: "h1",
    classes: ["title", "big", "x"],
    path: "body > main > h1",
    textContent: "  Hello\n   world ",
    rect: { x: 1, y: 2, width: 3, height: 4 },
  });
  assert.equal(out.element, "h1.title.big");
  assert.equal(out.fullPath, "main > h1.title");
  assert.equal(out.elementPath, "body > main > h1");
  assert.equal(out.nearbyText, "Hello world");
  assert.deepEqual(out.boundingBox, { x: 1, y: 2, width: 3, height: 4 });
  assert.equal(inspectedPick({ selector: "#a", name: "Save button" }).element, "Save button");
});

test("bridgeComment carries InterfaceKit style edits", () => {
  const comment = bridgeComment({ text: "x", picks: [], selection: null, page, workingFile: null, pendingEdits: "color: red", requestId: "r3", timestamp: "t" });
  assert.equal(comment.pendingEdits, "color: red");
});
