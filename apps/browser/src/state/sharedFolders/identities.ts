import { nameOfFile, type BaseEntry, type BaseLink, type LocalEntry, type LocalLink, type RemoteEntry, type RemoteLevel, type RemoteLink } from "./tree";

export type Identities = {
  baseIds: Set<string>;
  moved: Map<BaseLink, RemoteLink>;
  arriving: Map<RemoteLink, BaseLink>;
  arrivingKeys: Set<string>;
  localLinks: Map<string, LocalLink>;
};

const linksIn = (level: RemoteLevel): RemoteLink[] => level.entries.flatMap((r) => (r.kind === "link" ? [r] : r.kind === "dir" ? linksIn(r.level) : []));

const baseLinks = (base: BaseEntry[]): BaseLink[] => base.flatMap((b) => (b.kind === "link" ? [b] : baseLinks(b.children)));

function localLinks(local: LocalEntry[], into: Map<string, LocalLink>) {
  for (const l of local) l.kind === "link" ? into.set(l.key, l) : localLinks(l.children, into);
  return into;
}

export const preferred = (b: BaseLink, candidates: RemoteLink[]): RemoteLink | undefined =>
  candidates.find((r) => r.file === b.file) ?? candidates.find((r) => nameOfFile(r.file, "link") === b.name) ?? candidates[0];

function matchedDir(b: Extract<BaseEntry, { kind: "dir" }>, remote: RemoteLevel): RemoteEntry | undefined {
  const dirs = remote.entries.filter((r): r is Extract<RemoteEntry, { kind: "dir" }> => r.kind === "dir");
  return dirs.find((r) => r.file === b.file) ?? dirs.find((r) => b.children.some((c) => r.level.entries.some((x) => x.file === c.file)));
}

function staying(base: BaseEntry[], remote: RemoteLevel | null, into: Set<BaseLink>) {
  const here = new Set(remote ? remote.entries.flatMap((r) => (r.kind === "link" && r.id ? [r.id] : [])) : []);
  for (const b of base) {
    if (b.kind === "link") {
      if (b.id && here.has(b.id)) into.add(b);
      continue;
    }
    const r = remote ? matchedDir(b, remote) : undefined;
    staying(b.children, r?.kind === "dir" ? r.level : null, into);
  }
  return into;
}

export function identities(base: BaseEntry[], local: LocalEntry[], remote: RemoteLevel): Identities {
  const links = baseLinks(base);
  const baseIds = new Set(links.flatMap((b) => (b.id ? [b.id] : [])));
  const stays = staying(base, remote, new Set());
  const byId = new Map<string, RemoteLink[]>();
  for (const r of linksIn(remote)) if (r.id) byId.set(r.id, [...(byId.get(r.id) ?? []), r]);
  const moved = new Map<BaseLink, RemoteLink>();
  const arriving = new Map<RemoteLink, BaseLink>();
  for (const b of links) {
    if (!b.id || stays.has(b)) continue;
    const r = preferred(b, byId.get(b.id) ?? []);
    if (r && !arriving.has(r)) (moved.set(b, r), arriving.set(r, b));
  }
  return { baseIds, moved, arriving, arrivingKeys: new Set([...moved.keys()].map((b) => b.key)), localLinks: localLinks(local, new Map()) };
}
