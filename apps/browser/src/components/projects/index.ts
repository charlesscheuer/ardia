import {
  chooseProjectFolder,
  inspectProjectFolder,
  projectForPort,
  runProjectCommand,
  type LocalProject,
  type ProjectFolder,
  type ProjectRunResult,
  type ProjectServer,
} from "@ardia/shell";
import { useEffect, useState } from "react";
import { useBrowser } from "../../store/browser";
import { hideKeyedToast, showToast } from "../layout/splitActions";
import { openFromBar } from "../omnibox/open";
import { detectDevCommand, NO_DEV_COMMAND, type DevCommand } from "./detect";
import { localPortOf } from "./localhost";

export type { LocalProject, ProjectRunResult, ProjectServer, RunningProject } from "@ardia/shell";
export { runningProjects, stopProject } from "@ardia/shell";
export type { DevCommand } from "./detect";
export { detectDevCommand } from "./detect";
export { localPortOf } from "./localhost";

const lookupTtl = 10_000;
const lookups = new Map<number, { at: number; project: Promise<LocalProject | null> }>();

function lookup(port: number): Promise<LocalProject | null> {
  const hit = lookups.get(port);
  if (hit && Date.now() - hit.at < lookupTtl) return hit.project;
  const project = projectForPort(port).catch(() => null);
  lookups.set(port, { at: Date.now(), project });
  return project;
}

export function projectForUrl(url: string | null | undefined): Promise<LocalProject | null> {
  const port = localPortOf(url);
  return port == null ? Promise.resolve(null) : lookup(port);
}

export function useProjectForUrl(url: string | null | undefined): LocalProject | null {
  const port = localPortOf(url);
  const [found, setFound] = useState<{ port: number; project: LocalProject | null } | null>(null);
  useEffect(() => {
    if (port == null) return;
    let live = true;
    void lookup(port).then((project) => live && setFound({ port, project }));
    return () => {
      live = false;
    };
  }, [port, url]);
  return port != null && found?.port === port ? found.project : null;
}

export async function startProject(
  path: string,
  onCommand?: (command: DevCommand, folder: ProjectFolder) => void,
): Promise<ProjectRunResult> {
  const folder = await inspectProjectFolder(path).catch(() => null);
  if (!folder) return { ok: false, error: "That folder doesn't exist." };
  const command = detectDevCommand(folder);
  if (!command) return { ok: false, error: NO_DEV_COMMAND };
  onCommand?.(command, folder);
  const result = await runProjectCommand(folder.path, command.command).catch(
    (error: unknown): ProjectRunResult => ({ ok: false, error: error instanceof Error ? error.message : String(error) }),
  );
  if (result.ok) lookups.delete(result.port);
  return result;
}

const folderName = (path: string) => path.split("/").filter(Boolean).pop() ?? path;

export async function openProjectInTab(tabId: string, path?: string): Promise<ProjectServer | null> {
  const windowId = useBrowser.getState().tabs[tabId]?.windowId;
  if (!windowId) return null;
  const folder = await chooseProjectFolder(path ?? null);
  if (!folder) return null;
  const key = `project:${folder}`;
  const result = await startProject(folder, (command, info) =>
    showToast(windowId, `Starting ${info.name}`, command.command, { icon: "terminal", key, sticky: true }),
  );
  hideKeyedToast(windowId, key);
  if (!result.ok) {
    const log = result.log;
    showToast(windowId, `${folderName(folder)} Didn't Start`, result.error, {
      icon: "exclamationmark.triangle",
      key: `${key}:failed`,
      action: log ? { title: "Show Log", run: () => openInNewTab(windowId, tabId, `file://${encodeURI(log)}`) } : undefined,
    });
    return null;
  }
  const s = useBrowser.getState();
  if (s.tabs[tabId]) openFromBar(result.url, tabId, "current");
  else openInNewTab(windowId, tabId, result.url);
  return result;
}

function openInNewTab(windowId: string, tabId: string, url: string) {
  const s = useBrowser.getState();
  if (!s.windows[windowId]) return;
  s.newTab(windowId, { url, profileId: s.tabs[tabId]?.profileId });
}
