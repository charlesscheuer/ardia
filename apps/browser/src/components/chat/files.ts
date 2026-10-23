import { pickFiles, readPickedFile, writePickedFile } from "@ardia/shell";
import type { WorkingFile } from "./types";

export const fileNameOf = (url: string): string => {
  const last = url.split("/").filter(Boolean).pop() ?? url;
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
};

export async function loadWorkingFile(url: string): Promise<WorkingFile | { error: string }> {
  const content = await readPickedFile(url);
  if (content == null) return { error: `Couldn't read ${fileNameOf(url)} as text.` };
  return { url, name: fileNameOf(url), content };
}

export async function chooseWorkingFile(): Promise<WorkingFile | { error: string } | null> {
  const urls = await pickFiles();
  const url = urls.find((u) => u.startsWith("file:"));
  if (!url) return null;
  return loadWorkingFile(url);
}

export const applyWorkingFileEdit = (file: WorkingFile, contents: string): Promise<boolean> => writePickedFile(file.url, contents);
