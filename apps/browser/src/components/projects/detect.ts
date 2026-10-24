export type PackageManager = "pnpm" | "yarn" | "bun" | "npm";

export type DevCommandSource = "ikdev" | "dev" | "start" | "static";

export type DevCommand = { command: string; source: DevCommandSource; manager?: PackageManager };

export type ProjectFiles = { files: readonly string[]; ikdev?: string | null; packageJson?: string | null };

export const STATIC_SERVER_COMMAND = "python3 -m http.server $PORT --bind 127.0.0.1";

export const NO_DEV_COMMAND = "Add a dev script to package.json, an index.html or a .ikdev file.";

export function ikdevCommand(text: string | null | undefined): string | null {
  for (const raw of (text ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (line && !line.startsWith("#")) return line;
  }
  return null;
}

const managerNames: readonly PackageManager[] = ["pnpm", "yarn", "bun", "npm"];

export function packageManagerFor(files: readonly string[], packageManagerField?: unknown): PackageManager {
  const has = (name: string) => files.includes(name);
  if (has("pnpm-lock.yaml")) return "pnpm";
  if (has("yarn.lock")) return "yarn";
  if (has("bun.lock") || has("bun.lockb")) return "bun";
  if (has("package-lock.json")) return "npm";
  if (typeof packageManagerField === "string") {
    const named = managerNames.find((m) => packageManagerField === m || packageManagerField.startsWith(`${m}@`));
    if (named) return named;
  }
  return "npm";
}

const commandWrappers = new Set(["cross-env", "npx", "bunx", "dotenv", "env"]);

const portFlags: Record<string, (sub: string | undefined) => string | null> = {
  vite: (sub) => (sub === "build" || sub === "optimize" ? null : "--port $PORT --strictPort"),
  astro: (sub) => (sub === "dev" || sub === "start" || sub === "preview" ? "--port $PORT" : null),
  nuxt: (sub) => (sub === "dev" ? "--port $PORT" : null),
  nuxi: (sub) => (sub === "dev" ? "--port $PORT" : null),
  vitepress: (sub) => (sub === "dev" ? "--port $PORT" : null),
  webpack: (sub) => (sub === "serve" ? "--port $PORT" : null),
  "webpack-dev-server": () => "--port $PORT",
  parcel: (sub) => (sub === "build" ? null : "--port $PORT"),
  ng: (sub) => (sub === "serve" ? "--port $PORT" : null),
  gatsby: (sub) => (sub === "develop" ? "-p $PORT" : null),
  remix: (sub) => (sub === "vite:dev" ? "--port $PORT" : null),
  wrangler: (sub) => (sub === "dev" ? "--port $PORT" : null),
  storybook: (sub) => (sub === "dev" ? "-p $PORT" : null),
  "start-storybook": () => "-p $PORT",
  docusaurus: (sub) => (sub === "start" ? "--port $PORT" : null),
  "http-server": () => "-p $PORT",
  "live-server": () => "--port=$PORT",
};

export function portFlagsFor(script: string): string | null {
  const last = script.split(/&&|\|\||;/).pop()?.trim() ?? "";
  if (!last || /[|&]/.test(last) || /(^|\s)(--port|-p|-l|--listen)(=|\s|$)/.test(last)) return null;
  const tokens = last.split(/\s+/);
  let i = 0;
  const skipped = (token: string | undefined) => token != null && (commandWrappers.has(token) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(token));
  while (skipped(tokens[i])) i++;
  const tool = tokens[i]?.split("/").pop();
  if (!tool) return null;
  const sub = tokens.slice(i + 1).find((t) => !t.startsWith("-"));
  return portFlags[tool]?.(sub) ?? null;
}

export function runScriptCommand(manager: PackageManager, script: string, extra?: string | null): string {
  const base = `${manager} run ${script}`;
  if (!extra) return base;
  return manager === "npm" ? `${base} -- ${extra}` : `${base} ${extra}`;
}

function packageScripts(packageJson: string | null | undefined): { scripts: Record<string, unknown>; packageManager?: unknown } | null {
  if (!packageJson) return null;
  try {
    const parsed = JSON.parse(packageJson);
    if (!parsed || typeof parsed !== "object") return null;
    const scripts = parsed.scripts && typeof parsed.scripts === "object" ? parsed.scripts : {};
    return { scripts, packageManager: parsed.packageManager };
  } catch {
    return null;
  }
}

export function detectDevCommand(project: ProjectFiles): DevCommand | null {
  const ikdev = ikdevCommand(project.ikdev);
  if (ikdev) return { command: ikdev, source: "ikdev" };
  const pkg = packageScripts(project.packageJson);
  if (pkg) {
    for (const name of ["dev", "start"] as const) {
      const script = pkg.scripts[name];
      if (typeof script !== "string" || !script.trim()) continue;
      const manager = packageManagerFor(project.files, pkg.packageManager);
      return { command: runScriptCommand(manager, name, portFlagsFor(script)), source: name, manager };
    }
  }
  if (project.files.includes("index.html")) return { command: STATIC_SERVER_COMMAND, source: "static" };
  return null;
}
