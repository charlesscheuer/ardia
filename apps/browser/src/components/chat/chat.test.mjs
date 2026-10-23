import assert from "node:assert/strict";
import { test } from "node:test";

const { formatPicks, formatSelection } = await import("./agentationOutput.ts");
const { lineDiff, diffCounts } = await import("./diff.ts");

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
