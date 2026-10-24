import assert from "node:assert/strict";
import { test } from "node:test";
import { detectDevCommand, ikdevCommand, NO_DEV_COMMAND, packageManagerFor, portFlagsFor, runScriptCommand, STATIC_SERVER_COMMAND } from "./detect.ts";
import { localPortOf } from "./localhost.ts";

const pkg = (scripts, extra = {}) => JSON.stringify({ name: "app", scripts, ...extra });

test("a .ikdev file wins over package.json and index.html", () => {
  const project = { files: [".ikdev", "package.json", "index.html"], ikdev: "\n# comment\n  bin/serve --port $IK_PORT  \nignored\n", packageJson: pkg({ dev: "vite" }) };
  assert.deepEqual(detectDevCommand(project), { command: "bin/serve --port $IK_PORT", source: "ikdev" });
});

test("an empty .ikdev falls through to package.json", () => {
  const project = { files: [".ikdev", "package.json", "yarn.lock"], ikdev: "# nothing\n\n", packageJson: pkg({ dev: "next dev" }) };
  assert.deepEqual(detectDevCommand(project), { command: "yarn run dev", source: "dev", manager: "yarn" });
});

test("package.json dev, then start, run with the repo's package manager", () => {
  assert.deepEqual(detectDevCommand({ files: ["pnpm-lock.yaml"], packageJson: pkg({ dev: "vite", start: "node server.js" }) }), {
    command: "pnpm run dev --port $PORT --strictPort",
    source: "dev",
    manager: "pnpm",
  });
  assert.deepEqual(detectDevCommand({ files: ["package-lock.json"], packageJson: pkg({ start: "react-scripts start" }) }), {
    command: "npm run start",
    source: "start",
    manager: "npm",
  });
  assert.deepEqual(detectDevCommand({ files: [], packageJson: pkg({ dev: "  ", start: "astro dev" }) }), {
    command: "npm run start -- --port $PORT",
    source: "start",
    manager: "npm",
  });
});

test("no dev or start script falls back to a static server only with an index.html", () => {
  assert.deepEqual(detectDevCommand({ files: ["package.json", "index.html"], packageJson: pkg({ build: "tsc" }) }), {
    command: STATIC_SERVER_COMMAND,
    source: "static",
  });
  assert.deepEqual(detectDevCommand({ files: ["index.html"] }), { command: STATIC_SERVER_COMMAND, source: "static" });
  assert.equal(detectDevCommand({ files: ["package.json"], packageJson: pkg({ build: "tsc" }) }), null);
  assert.equal(detectDevCommand({ files: ["README.md"] }), null);
  assert.equal(detectDevCommand({ files: ["package.json"], packageJson: "{ not json" }), null);
  assert.match(NO_DEV_COMMAND, /\.ikdev/);
});

test("package manager: lockfile first, then the packageManager field, else npm", () => {
  assert.equal(packageManagerFor(["pnpm-lock.yaml", "yarn.lock"]), "pnpm");
  assert.equal(packageManagerFor(["yarn.lock"]), "yarn");
  assert.equal(packageManagerFor(["bun.lock"]), "bun");
  assert.equal(packageManagerFor(["bun.lockb"]), "bun");
  assert.equal(packageManagerFor(["package-lock.json"], "pnpm@9.1.0"), "npm");
  assert.equal(packageManagerFor([], "pnpm@9.1.0"), "pnpm");
  assert.equal(packageManagerFor([], "yarn@4.0.0"), "yarn");
  assert.equal(packageManagerFor([], "deno@2"), "npm");
  assert.equal(packageManagerFor([]), "npm");
});

test("script arguments go through npm's -- and straight through the others", () => {
  assert.equal(runScriptCommand("npm", "dev", "--port $PORT"), "npm run dev -- --port $PORT");
  assert.equal(runScriptCommand("pnpm", "dev", "--port $PORT"), "pnpm run dev --port $PORT");
  assert.equal(runScriptCommand("bun", "start", null), "bun run start");
});

test("port flags only for servers that ignore PORT, and never twice", () => {
  assert.equal(portFlagsFor("vite"), "--port $PORT --strictPort");
  assert.equal(portFlagsFor("vite --host"), "--port $PORT --strictPort");
  assert.equal(portFlagsFor("vite build"), null);
  assert.equal(portFlagsFor("NODE_ENV=development cross-env FOO=1 vite dev"), "--port $PORT --strictPort");
  assert.equal(portFlagsFor("tsc -b && vite"), "--port $PORT --strictPort");
  assert.equal(portFlagsFor("./node_modules/.bin/vite"), "--port $PORT --strictPort");
  assert.equal(portFlagsFor("vite --port 3000"), null);
  assert.equal(portFlagsFor("next dev"), null);
  assert.equal(portFlagsFor("next dev -p 4000"), null);
  assert.equal(portFlagsFor("react-scripts start"), null);
  assert.equal(portFlagsFor("concurrently \"vite\" \"tsc -w\""), null);
  assert.equal(portFlagsFor("vite | tee log"), null);
  assert.equal(portFlagsFor("gatsby develop"), "-p $PORT");
  assert.equal(portFlagsFor("ng serve"), "--port $PORT");
  assert.equal(portFlagsFor("python3 -m http.server $PORT"), null);
});

test("ikdev: first meaningful line", () => {
  assert.equal(ikdevCommand(null), null);
  assert.equal(ikdevCommand("\r\n  pnpm dev --port $IK_PORT\r\n"), "pnpm dev --port $IK_PORT");
});

test("local ports only for http(s) localhost, 127.0.0.1 and [::1]", () => {
  assert.equal(localPortOf("http://localhost:5173/"), 5173);
  assert.equal(localPortOf("http://localhost:5173"), 5173);
  assert.equal(localPortOf("https://LOCALHOST:8443/a?b#c"), 8443);
  assert.equal(localPortOf("http://127.0.0.1:3000/x"), 3000);
  assert.equal(localPortOf("http://[::1]:4321/"), 4321);
  assert.equal(localPortOf("http://user@localhost:9000/"), 9000);
  assert.equal(localPortOf("http://localhost/"), 80);
  assert.equal(localPortOf("https://localhost"), 443);
  assert.equal(localPortOf("http://localhost.example.com:80/"), null);
  assert.equal(localPortOf("http://localhostx:80/"), null);
  assert.equal(localPortOf("http://evil.com/?http://localhost:5173"), null);
  assert.equal(localPortOf("http://localhost:0/"), null);
  assert.equal(localPortOf("http://localhost:70000/"), null);
  assert.equal(localPortOf("file:///Users/x/index.html"), null);
  assert.equal(localPortOf("ws://localhost:5173/"), null);
  assert.equal(localPortOf(""), null);
  assert.equal(localPortOf(null), null);
});
