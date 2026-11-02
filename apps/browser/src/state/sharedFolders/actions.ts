import { confirm, pickFolder } from "../../platform/dialogs";
import { sharePage } from "../../platform/share";
import { createSharedFolder, revealSharedFolder, sharedLocation } from "../../platform/sharedFolders";
import { useBrowser, type BrowserState } from "../browser/store";
import type { Tab } from "../browser/types";
import { IDLE_LIVE, isIncognitoProfile, makeTab, newId, pinKeyOf } from "../browser/model";
import { pinnedGroupMembers } from "../browser/structure";
import { insertAll, nestGroups, orderSections, syncGroupOrder } from "../groups/groups";
import { markPinned } from "../pins/pinChoices";
import { groupLabel } from "../pins/tabGrouping";
import { ASLEEP } from "../tabs/pageSession";
import { isRegularWindow } from "../windows/small";
import { measureRow } from "../sidebar/sidebarUi";
import { EMPTY_FOLDER_URL } from "./applyFolder";
import { syncFolderNow } from "./engine";
import { bindFolder, boundFolders, sharedFolderOf, unbindFolder, type SharedFolder } from "./store";

const store = () => useBrowser.getState();

export function sharedFolderOfGroup(s: Pick<BrowserState, "groups">, groupId: string): { profileId: string; key: string; folder: SharedFolder } | null {
  const g = s.groups[groupId];
  if (!g?.pinned || g.parentId) return null;
  const key = pinKeyOf(g);
  const folder = sharedFolderOf(g.profileId, key);
  return folder ? { profileId: g.profileId, key, folder } : null;
}

export const canShareGroup = (s: Pick<BrowserState, "groups">, groupId: string) => {
  const g = s.groups[groupId];
  return !!g?.pinned && !g.parentId && !isIncognitoProfile(g.profileId);
};

export function folderLabel(path: string): string {
  const { iCloudPath } = sharedLocation();
  if (iCloudPath && path.startsWith(`${iCloudPath}/`)) return ["iCloud Drive", ...path.slice(iCloudPath.length + 1).split("/")].join(" › ");
  return path;
}

export const fileUrlOf = (path: string) => `file://${path.split("/").map(encodeURIComponent).join("/")}/`;

async function chooseParent(windowId: string): Promise<string | null> {
  const location = sharedLocation();
  if (location.iCloudAvailable) return location.path;
  const { confirmed } = await confirm({
    title: "iCloud Drive Is Off",
    message:
      "Shared folders live in iCloud Drive, where the people you invite get your changes. Turn it on in System Settings › Apple Account › iCloud, or keep the folder in another folder that syncs, like one in Dropbox.",
    confirmTitle: "Choose Folder…",
    windowId,
  });
  return confirmed ? pickFolder(null, "Use Folder") : null;
}

export function withSharedGroup(s: BrowserState, windowId: string, name: string): [BrowserState, string] {
  const w = s.windows[windowId];
  if (!isRegularWindow(w)) return [s, ""];
  const profileId = w.profileId;
  const tab: Tab = { ...makeTab(windowId, profileId, EMPTY_FOLDER_URL, { title: "Empty Folder", customTitle: "Empty Folder" }), page: ASLEEP };
  const id = newId("g");
  const groups = nestGroups({
    ...s.groups,
    [id]: { id, windowId, profileId, name, icon: null, color: null, collapsed: false, pinned: true, tabIds: [tab.id], createdAt: Date.now() },
  });
  const tabs = { ...s.tabs, [tab.id]: tab };
  const pinnedArea = pinnedGroupMembers(s.groups);
  const ids = [...w.tabIds];
  insertAll(ids, w.tabIds.reduce((last, t, i) => (s.tabs[t]?.pin || pinnedArea.has(t) ? i + 1 : last), 0), [tab.id]);
  const window = { ...w, tabIds: orderSections(ids, tabs, groups) };
  const pinChoices = markPinned(s.pinChoices, profileId, { groups: [id], placed: [tab.id] });
  return [{ ...s, tabs, live: { ...s.live, [tab.id]: IDLE_LIVE }, pinChoices, groups: syncGroupOrder(groups, window), windows: { ...s.windows, [windowId]: window } }, id];
}

export async function addSharedFolder(windowId: string) {
  const w = store().windows[windowId];
  if (!isRegularWindow(w) || isIncognitoProfile(w.profileId)) return;
  const location = sharedLocation();
  const start = location.iCloudAvailable ? location.path : await chooseParent(windowId);
  if (!start) return;
  const path = await pickFolder(start, "Add Folder");
  if (!path) return;
  const profileId = store().windows[windowId]?.profileId ?? w.profileId;
  const known = boundFolders().find((b) => b.profileId === profileId && b.folder.path === path);
  if (known) return syncFolderNow(profileId, known.key);
  const [next, groupId] = withSharedGroup(store(), windowId, path.split("/").filter(Boolean).at(-1) ?? "Shared Folder");
  if (!groupId) return;
  useBrowser.setState(next);
  const key = pinKeyOf(store().groups[groupId]!);
  bindFolder(profileId, key, path);
  await syncFolderNow(profileId, key);
}

export async function shareFolder(windowId: string, groupId: string) {
  const s = store();
  const g = s.groups[groupId];
  if (!g || !canShareGroup(s, groupId)) return;
  const key = pinKeyOf(g);
  let folder = sharedFolderOf(g.profileId, key);
  if (!folder) {
    const parent = await chooseParent(windowId);
    if (!parent) return;
    const path = await createSharedFolder(parent, groupLabel(s, g) || "Shared Folder");
    bindFolder(g.profileId, key, path);
    await syncFolderNow(g.profileId, key);
    folder = sharedFolderOf(g.profileId, key);
    if (!folder) return;
  }
  const anchor = await measureRow(windowId, groupId);
  await sharePage(fileUrlOf(folder.path), groupLabel(store(), g) || null, windowId, anchor ? [anchor.x, anchor.y, anchor.width, anchor.height] : null);
}

export function revealGroupFolder(groupId: string) {
  const shared = sharedFolderOfGroup(store(), groupId);
  if (shared) void revealSharedFolder(shared.folder.path);
}

export function stopSyncingGroup(groupId: string) {
  const shared = sharedFolderOfGroup(store(), groupId);
  if (shared) unbindFolder(shared.profileId, shared.key);
}

export async function confirmRemovingShared(windowId: string, groupId: string): Promise<boolean> {
  const shared = sharedFolderOfGroup(store(), groupId);
  if (!shared) return true;
  const g = store().groups[groupId];
  const name = (g && groupLabel(store(), g)) || "this folder";
  const { confirmed } = await confirm({
    title: `Remove “${name}” from the Sidebar?`,
    message: `The folder stays in ${folderLabel(shared.folder.path)}, with every link in it, and the people you shared it with keep it. Ardia only stops syncing it on this Mac.`,
    confirmTitle: "Remove",
    destructive: true,
    windowId,
  });
  return confirmed;
}
