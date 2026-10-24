import { requireOptionalNativeModule } from "expo-modules-core";

export type ProjectFolder = {
  path: string;
  name: string;
  files: string[];
  ikdev?: string;
  packageJson?: string;
};

export type ProjectServer = {
  ok: true;
  path: string;
  name: string;
  port: number;
  url: string;
  pid: number;
  command: string;
  log: string;
  startedAt: number;
  reused: boolean;
};

export type ProjectRunFailure = { ok: false; error: string; log?: string; logTail?: string };

export type ProjectRunResult = ProjectServer | ProjectRunFailure;

export type RunningProject = {
  path: string;
  name: string;
  port: number;
  url: string;
  pid: number;
  command: string;
  log: string;
  startedAt: number;
  ready: boolean;
};

export type LocalProject = {
  path: string;
  name: string;
  port: number;
  pid: number;
  managed: boolean;
  gitRoot?: string;
  branch?: string;
  command?: string;
};

const Projects = requireOptionalNativeModule<{
  chooseProject(path: string | null): Promise<string | null>;
  inspectProject(path: string): Promise<ProjectFolder | null>;
  runProject(path: string, command: string): Promise<ProjectRunResult>;
  stopProject(path: string): Promise<boolean>;
  runningProjects(): Promise<RunningProject[]>;
  projectForPort(port: number): Promise<LocalProject | null>;
}>("ArdiaProjects");

const unavailable: ProjectRunFailure = { ok: false, error: "This build of Ardia can't run projects." };

export const projectRunnerAvailable = () => Projects != null;

export const chooseProjectFolder = (path?: string | null): Promise<string | null> =>
  Projects ? Projects.chooseProject(path ?? null) : Promise.resolve(null);

export const inspectProjectFolder = (path: string): Promise<ProjectFolder | null> =>
  Projects ? Projects.inspectProject(path) : Promise.resolve(null);

export const runProjectCommand = (path: string, command: string): Promise<ProjectRunResult> =>
  Projects ? Projects.runProject(path, command) : Promise.resolve(unavailable);

export const stopProject = (path: string): Promise<boolean> => (Projects ? Projects.stopProject(path) : Promise.resolve(false));

export const runningProjects = (): Promise<RunningProject[]> => (Projects ? Projects.runningProjects() : Promise.resolve([]));

export const projectForPort = (port: number): Promise<LocalProject | null> =>
  Projects ? Projects.projectForPort(port) : Promise.resolve(null);
