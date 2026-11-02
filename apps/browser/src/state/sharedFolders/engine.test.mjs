import assert from "node:assert/strict";
import { test } from "node:test";

const webloc = (url) => `<plist><dict><key>URL</key><string>${url}</string></dict></plist>`;
const events = [];
const files = new Map();
const landed = new Map();
const pending = new Map();
const failing = new Set();
const unstageable = new Set();
let listing = { exists: true, root: { entries: [], manifest: null, manifestPending: false } };

function land(name) {
  const contents = pending.get(name);
  if (contents === undefined) return null;
  if (failing.has(name)) return new Error(`saving ${name} failed`);
  pending.delete(name);
  landed.set(name, contents);
  events.push(`landed ${name}`);
  return null;
}

globalThis.acTestNativeModules = {
  ArdiaDocuments: {
    readDocument: (name) => pending.get(name) ?? landed.get(name) ?? null,
    writeDocument: (name, contents) => {
      if (unstageable.has(name)) throw new Error(`can't stage ${name}`);
      pending.set(name, contents);
      setTimeout(() => land(name), 5);
    },
    saveDocument: async (name, contents) => void pending.set(name, contents),
    documentSaved: (name) =>
      new Promise((resolve, reject) =>
        setTimeout(() => {
          events.push(`awaited ${name}`);
          const error = land(name);
          error ? reject(error) : resolve();
        }, 20),
      ),
    removeDocument: (name) => void (pending.delete(name), landed.delete(name)),
  },
  ArdiaSharedFolders: {
    location: () => ({ path: "/scratch/Ardia Shared", iCloudAvailable: true, iCloudPath: "/scratch" }),
    read: async () => listing,
    apply: async (_path, ops) => (events.push(`apply ${JSON.parse(ops).length}`), files.set("ops", JSON.parse(ops)), { conflicts: [] }),
    create: async (parent, name) => `${parent}/${name}`,
    watch: () => {},
    addListener: () => ({ remove() {} }),
  },
};

const { startPersistence } = await import("../session/persist.ts");
const { useBrowser } = await import("../browser/store.ts");
const { pinKeyOf } = await import("../browser/model.ts");
const { syncFolderNow } = await import("./engine.ts");
const { bindFolder, sharedFolderOf, useSharedFolders } = await import("./store.ts");

const S = () => useBrowser.getState();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function setup() {
  startPersistence();
  const w = S().createWindow({ url: "https://home.example/" });
  const t = S().newTab(w, { url: "https://one.example/", background: true });
  const g = S().groupTabs([t], { pinned: true, name: "Team" });
  const profileId = S().groups[g].profileId;
  const key = pinKeyOf(S().groups[g]);
  bindFolder(profileId, key, "/scratch/Ardia Shared/Team");
  return { profileId, key };
}

test("a session that can't be saved stops the round before any file changes or base advance", async () => {
  const { profileId, key } = setup();
  await wait(900);
  listing = { exists: true, root: { entries: [{ kind: "link", file: "From Mac B.webloc", text: webloc("https://b.example/") }], manifest: null, manifestPending: false } };
  failing.add("session.json");
  events.length = 0;
  await syncFolderNow(profileId, key);
  assert.ok(S().groups && Object.values(S().tabs).some((t) => t.pinnedUrl === "https://b.example/"), "the sidebar shows the link");
  assert.deepEqual(events.filter((e) => e.startsWith("apply")), [], "no file is touched");
  assert.equal(sharedFolderOf(profileId, key).base.length, 0, "the base doesn't move");
  assert.notEqual(useSharedFolders.getState().sync[`${profileId}\u0001${key}`]?.state, "synced");
  await wait(600);
  assert.ok(!(landed.get("shared-folders.json") ?? "").includes("b.example"), "no saved base names the link");

  failing.delete("session.json");
  events.length = 0;
  await syncFolderNow(profileId, key);
  const imported = sharedFolderOf(profileId, key).base.find((b) => b.url === "https://b.example/")?.key;
  assert.ok(imported, "once the session lands, the base takes the link");
  assert.ok(landed.get("session.json").includes(imported), "the landed session holds the tab");
  const sessionLanded = events.findIndex((e) => e === "landed session.json");
  const firstApply = events.findIndex((e) => e.startsWith("apply"));
  assert.ok(sessionLanded >= 0 && firstApply > sessionLanded, `the session landed (#${sessionLanded}) before any file change (#${firstApply})`);
});

test("a session snapshot that never got staged stops the round too, and is staged again next time", async () => {
  const w = S().createWindow({ url: "https://home2.example/" });
  const t = S().newTab(w, { url: "https://two.example/", background: true });
  const g = S().groupTabs([t], { pinned: true, name: "Second" });
  const profileId = S().groups[g].profileId;
  const key = pinKeyOf(S().groups[g]);
  bindFolder(profileId, key, "/scratch/Ardia Shared/Second");
  await wait(900);
  listing = { exists: true, root: { entries: [{ kind: "link", file: "Staged.webloc", text: webloc("https://staged.example/") }], manifest: null, manifestPending: false } };
  unstageable.add("session.json");
  events.length = 0;
  await syncFolderNow(profileId, key);
  assert.deepEqual(events.filter((e) => e.startsWith("apply")), [], "no file is touched while the session can't be staged");
  assert.equal(sharedFolderOf(profileId, key).base.length, 0, "the base doesn't move");
  unstageable.delete("session.json");
  events.length = 0;
  await syncFolderNow(profileId, key);
  const imported = sharedFolderOf(profileId, key).base.find((b) => b.url === "https://staged.example/")?.key;
  assert.ok(imported, "the next round goes through");
  assert.ok(landed.get("session.json").includes(imported), "the session that landed holds the tab");
});
