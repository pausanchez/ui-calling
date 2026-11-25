#!/usr/bin/env node
// ui-calling: set up UI_calling in a project and copy surfaces into it. You own the code afterwards.
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const registryDir = join(pkgDir, "registry");
const TEMPLATES = { surface: join(pkgDir, "templates", "surface"), steps: join(pkgDir, "templates", "steps") };
const initTemplates = join(pkgDir, "templates", "init");
const registry = JSON.parse(readFileSync(join(registryDir, "registry.json"), "utf8"));

/** Written by `init`, read by `new` and `add`: where things live in this project (like shadcn's components.json). */
const CONFIG_FILE = "ui-calling.json";

/** The package `init` ran in: the nearest folder with a package.json, from here up. Paths in the config are relative to it. */
function packageRoot(dir = process.cwd()) {
  for (let d = resolve(dir); ; d = dirname(d)) {
    if (existsSync(join(d, "package.json"))) return d;
    if (dirname(d) === d) return process.cwd();
  }
}
const root = packageRoot();
const configPath = join(root, CONFIG_FILE);
const raw = existsSync(configPath) ? JSON.parse(readFileSync(configPath, "utf8")) : null;
const fromRoot = (p) => (p ? resolve(root, p) : undefined);
const config = raw && { ...raw, runtime: fromRoot(raw.runtime), screen: fromRoot(raw.screen), surfacesDir: fromRoot(raw.surfacesDir), serverDir: fromRoot(raw.serverDir) };

const VALUE_FLAGS = ["--identifier", "--dir", "--server-dir", "--framework", "--deliver", "--base-url", "--template", "--subject", "--locale", "--url", "--time-zone", "--conversation", "--port", "--webhook-path"];
const [cmd, ...all] = process.argv.slice(2);
// Everything after a bare "--" is passed through (e.g. the dev command for `whatsapp dev`).
const dashDash = all.indexOf("--");
const rest = dashDash === -1 ? all : all.slice(0, dashDash);
const passThrough = dashDash === -1 ? [] : all.slice(dashDash + 1);
const flag = (name, fallback) => {
  const i = rest.indexOf(name);
  return i >= 0 ? rest[i + 1] : fallback;
};
const force = rest.includes("--force");
// `add --replace`: like --force, and also rewrites the block's server and support files (your data code).
const replace = rest.includes("--replace");
// Flags are relative to where you run the command; the config's paths, to its package.
const outDir = flag("--dir") ? resolve(flag("--dir")) : (config?.surfacesDir ?? resolve(root, "src/components/ui-calling"));
const serverDir = flag("--server-dir") ? resolve(flag("--server-dir")) : flag("--dir") ? outDir : (config?.serverDir ?? outDir);

/** A monorepo root that isn't itself a Next.js or Vite app. */
function isWorkspaceRoot(dir) {
  if (!existsSync(join(dir, "package.json"))) return false;
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  return Boolean(pkg.workspaces || existsSync(join(dir, "pnpm-workspace.yaml"))) && !deps.next && !deps.vite;
}

/** A workspace root has no app of its own: generated files there would be wired to nothing. */
function refuseWorkspaceRoot(what) {
  if (config || flag("--dir") || force) return;
  if (!isWorkspaceRoot(root)) return;
  console.error(`${relative(process.cwd(), root) || "This folder"} is a monorepo root. Run \`ui-calling ${what}\` in the app's folder (where you ran \`ui-calling init\`), or pass --dir.`);
  process.exit(1);
}
const names = rest.filter((a, i) => !a.startsWith("--") && !VALUE_FLAGS.includes(rest[i - 1]));

function write(target, content) {
  if (existsSync(target) && !force && !replace) {
    console.log(`  skip   ${relative(process.cwd(), target)} (exists, use --force to overwrite)`);
    return false;
  }
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
  console.log(`  write  ${relative(process.cwd(), target)}`);
  return true;
}

/** Write a file even if it exists (for --replace). */
function writeOver(target, content) {
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
  console.log(`  write  ${relative(process.cwd(), target)}`);
  return true;
}

function copy(rel) {
  write(join(outDir, basename(rel)), readFileSync(join(registryDir, rel)));
}

/** Parts go in `<surfaces dir>/parts/`; screens import them from there. Already there: kept, unless --force. */
function addPart(name) {
  const part = registry.parts[name];
  for (const rel of part.files) {
    const target = join(outDir, "parts", basename(rel));
    if (existsSync(target) && !force) console.log(`  keep   ${shown(target)} (already there; --force replaces it)`);
    else write(target, readFileSync(join(registryDir, rel)));
  }
  return part;
}

/** Path for messages: relative to where the command runs. */
const shown = (p) => relative(process.cwd(), p) || ".";

/** Import path from the file at `fromFile` to `toFile`, without extension. */
function importPath(fromFile, toFile) {
  let p = relative(dirname(resolve(fromFile)), resolve(toFile)).split(sep).join("/").replace(/\.(tsx?|jsx?)$/, "");
  return p.startsWith(".") ? p : `./${p}`;
}

function fill(template, vars) {
  let s = readFileSync(join(initTemplates, template), "utf8");
  for (const [k, v] of Object.entries(vars)) s = s.replaceAll(k, v);
  return s;
}

/** Insert an import and an entry at the `ui-calling:` markers of a file `init` generated. Idempotent. */
function register(file, importLine, entry) {
  if (!file || !existsSync(file)) return false;
  let s = readFileSync(file, "utf8");
  if (!s.includes("// ui-calling:imports") || !s.includes("/* ui-calling:surfaces */")) return false;
  if (!s.includes(importLine)) s = s.replace("// ui-calling:imports", `${importLine}\n// ui-calling:imports`);
  // The same surface registered with other props (add link-account --identifier text): replace its entry.
  const key = entry.match(/^(\w+): /)?.[1];
  const existing = key && s.match(new RegExp(`^([ \\t]*)${key}: .*,$`, "m"));
  if (existing && !s.includes(entry)) s = s.replace(existing[0], `${existing[1]}${entry}`);
  else if (!s.includes(entry)) {
    // On a line of its own, each entry goes on a new line above the marker (a clean diff per surface);
    // an inline marker (older setups: `[/* ui-calling:surfaces */]`) keeps entries on its line.
    const own = s.match(/\n([ \t]*)\/\* ui-calling:surfaces \*\//);
    s = own
      ? s.replace(own[0], `\n${own[1]}${entry}${own[0]}`)
      : s.replace("/* ui-calling:surfaces */", `${entry} /* ui-calling:surfaces */`);
  }
  writeFileSync(file, s);
  console.log(`  update ${shown(file)}`);
  return true;
}

/** Register a surface's implementation in the runtime and its component in the screen, if `init` made them. */
function registerSurface({ impl, component, surface }, serverFile, screenFile, props = "") {
  const inRuntime = register(config?.runtime, `import { ${impl} } from "${importPath(config?.runtime ?? ".", serverFile)}";`, `${impl},`);
  const inScreen = register(config?.screen, `import { ${component} } from "${importPath(config?.screen ?? ".", screenFile)}";`, `${surface}: () => <${component}${props} />,`);
  return inRuntime && inScreen;
}

function newSurface(name) {
  if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(name)) {
    console.error(`"${name}" isn't a valid name. Use kebab-case, e.g. shift-picker.`);
    process.exit(1);
  }
  const words = name.split("-");
  const cap = (w) => w[0].toUpperCase() + w.slice(1);
  // The contract's constant is the camelCase name; the templates already use these names for their own variables.
  const TAKEN = ["note", "busy", "failed", "problem", "details", "choice", "nav", "step", "status", "data", "locale", "emit", "reload", "complete", "returnUrl", "errorCode", "options", "drafts", "saved", "store", "tableReady", "draftsTable", "readDraft", "writeDraft", "reached", "upstream", "known", "retryable", "key", "id", "base", "load", "save", "next", "go", "confirm", "btn", "messages", "t", "d", "e", "v"];
  const constName = words[0] + words.slice(1).map(cap).join("");
  if (TAKEN.includes(constName)) {
    console.error(`"${name}" clashes with a name the generated code already uses. Pick a more specific one, e.g. ${name}-form or site-${name}.`);
    process.exit(1);
  }
  const vars = {
    __MESSAGES__: `${words.join("_").toUpperCase()}_MESSAGES`,
    __Component__: words.map(cap).join(""),
    __const__: words[0] + words.slice(1).map(cap).join(""),
    __surface__: words.join("_"),
    __name__: name,
  };
  const template = flag("--template", "surface");
  const templateDir = TEMPLATES[template];
  if (!templateDir) {
    console.error(`Unknown template "${template}". Templates: ${Object.keys(TEMPLATES).join(", ")}.`);
    process.exit(1);
  }
  const serverFile = join(serverDir, `${name}.server.ts`);
  const screenFile = join(outDir, `${name}.tsx`);

  // The steps template keeps drafts in init's store (store.ts next to ui.ts). Without init, `new` writes one.
  const storeFile = join(config?.runtime ? dirname(config.runtime) : serverDir, "store.ts");
  for (const file of readdirSync(templateDir)) {
    const isServer = file.endsWith(".server.ts");
    let content = readFileSync(join(templateDir, file), "utf8");
    // Only the server file may live elsewhere; the screen sits next to its contract.
    if (isServer) content = content.replaceAll('"./__name__.surface"', `"${importPath(serverFile, join(outDir, `${name}.surface.ts`))}"`);
    if (content.includes('"../init/store"')) {
      if (!existsSync(storeFile)) write(storeFile, fill("store.ts", {}));
      content = content.replaceAll('"../init/store"', `"${importPath(serverFile, storeFile)}"`);
    }
    // The template imports parts from the registry (so the repo typechecks it); in your project they're in ./parts.
    for (const [, part] of content.matchAll(/"\.\.\/\.\.\/registry\/parts\/([a-z-]+)"/g)) {
      addPart(part);
      content = content.replaceAll(`"../../registry/parts/${part}"`, `"./parts/${part}"`);
    }
    for (const [key, value] of Object.entries(vars)) content = content.replaceAll(key, value);
    write(join(isServer ? serverDir : outDir, file.replace("__name__", name)), content);
  }

  // With a ui-calling.json from `init`, wire it up too.
  const registered = registerSurface({ impl: `${vars.__const__}Impl`, component: vars.__Component__, surface: vars.__surface__ }, serverFile, screenFile);

  console.log(`
Next:
  1. Fill the TODOs in ${name}.surface.ts: description, input, data, events.
  2. Load real data in ${name}.server.ts.${
    registered
      ? `\n  3. Already registered in ${shown(config.runtime)} and ${shown(config.screen)}.`
      : `\n  3. Register it: createUiCalling({ surfaces: [${vars.__const__}Impl, ...] }),\n     and render <${vars.__Component__} /> inside <SurfaceProvider> on your surface route.`
  }
  4. Run your typechecker: it points at anything left to change.

Patterns and rules: npx ui-calling guide`);
}

/**
 * `next dev` serves its own scripts only to localhost unless a host is listed in `allowedDevOrigins`: a screen opened
 * on a phone through a tunnel (PUBLIC_URL) stays blank. Add PUBLIC_URL's host there, once.
 */
const ALLOW_TUNNEL = `  // UI_calling: screens open on phones through a tunnel (PUBLIC_URL). \`next dev\` refuses its own scripts to any
  // host but localhost unless it's listed here, and the screen stays blank.
  allowedDevOrigins: process.env.PUBLIC_URL ? [new URL(process.env.PUBLIC_URL).hostname] : [],
`;
function allowTunnelInNextDev(done) {
  const file = ["next.config.ts", "next.config.mjs", "next.config.js"].find((f) => existsSync(f));
  const manual = `in next.config, add allowedDevOrigins: [<PUBLIC_URL's host>], or screens opened on a phone through a tunnel stay blank in next dev`;
  if (!file) return done.push(manual);
  const s = readFileSync(file, "utf8");
  if (s.includes("allowedDevOrigins")) return; // already handled, by you or a previous init
  // create-next-app's shape: `const nextConfig: NextConfig = {` (TypeScript) or `const nextConfig = {`.
  const opening = s.match(/const nextConfig(?::\s*NextConfig)?\s*=\s*\{\n/);
  if (!opening) return done.push(manual);
  writeFileSync(file, s.replace(opening[0], opening[0] + ALLOW_TUNNEL));
  console.log(`  update ${file}`);
}

/**
 * Vite has no server of its own: write a small Hono one for the API, proxy /api to it in development, and render
 * the screen on /s/:token. Each step that can't be done safely on your files becomes a line in "Next" instead.
 */
const API_PORT = 8787;
function setUpVite({ lib, serverLib, runtime, screen, done, todo, pkg }) {
  const serverEntry = join(serverLib, "index.ts");
  write(serverEntry, fill("vite-server.ts", { __UI_IMPORT__: importPath(serverEntry, runtime), __API_PORT__: String(API_PORT) }));
  const route = join(lib, "surface-route.tsx");
  write(route, fill("vite-surface-route.tsx", {}));
  done.push(`API server in ${serverEntry}`);

  // create-vite's `tsc -b` checks src/ (tsconfig.app.json) and vite.config (tsconfig.node.json): add the server.
  const serverPath = serverLib.split(sep).join("/");
  if (existsSync("tsconfig.json") && !existsSync("tsconfig.server.json")) {
    const ts = readFileSync("tsconfig.json", "utf8");
    const last = ts.match(/\{ "path": "\.\/tsconfig\.node\.json" \}/);
    if (last) {
      write("tsconfig.server.json", fill("vite-tsconfig.server.json", { __SERVER_DIR__: serverPath }));
      writeFileSync("tsconfig.json", ts.replace(last[0], `${last[0]},\n    { "path": "./tsconfig.server.json" }`));
      console.log("  update tsconfig.json");
    } else todo.push(`Typecheck ${serverPath}/ too: it's outside what your tsconfig includes.`);
  }

  if (!pkg.scripts?.["dev:api"]) {
    pkg.scripts = { ...pkg.scripts, "dev:api": `tsx watch --env-file-if-exists=.env ${serverEntry.split(sep).join("/")}` };
    writeFileSync("package.json", JSON.stringify(pkg, null, 2) + "\n");
    console.log("  update package.json (dev:api)");
  }

  // create-vite's shape: `export default defineConfig({`. Anything else, or a proxy of your own, is left to you.
  const config = ["vite.config.ts", "vite.config.mts", "vite.config.js", "vite.config.mjs"].find((f) => existsSync(f));
  const c = config && readFileSync(config, "utf8");
  if (c && !c.includes("/api") && !/\bserver\s*:/.test(c) && /defineConfig\(\{\n/.test(c)) {
    writeFileSync(config, c.replace(/defineConfig\(\{\n/, `defineConfig({\n  // UI_calling: the screens call /api/ui, served by ${serverEntry.split(sep).join("/")} (npm run dev:api).\n  server: { proxy: { "/api": "http://localhost:${API_PORT}" } },\n`));
    console.log(`  update ${config}`);
    done.push(`/api proxied to the API in ${config}`);
  } else if (!c?.includes("/api")) {
    todo.push(`In vite.config, proxy "/api" to http://localhost:${API_PORT} (server.proxy), so the screens reach the API.`);
  }

  // create-vite's main.tsx renders <App />: show the screen instead on /s/:token.
  const main = ["src/main.tsx", "src/main.jsx"].find((f) => existsSync(f));
  const m = main && readFileSync(main, "utf8");
  if (m && !m.includes("surfaceRoute") && m.split("<App />").length === 2) {
    const imports = [...m.matchAll(/^import .*$/gm)].at(-1);
    const withImport = imports
      ? m.slice(0, imports.index + imports[0].length) + `\nimport { surfaceRoute } from "${importPath(main, route)}";` + m.slice(imports.index + imports[0].length)
      : m;
    writeFileSync(main, withImport.replace("<App />", "{surfaceRoute() ?? <App />}"));
    console.log(`  update ${main}`);
    done.push(`screens render on /s/:token (${main})`);
  } else if (!m?.includes("surfaceRoute")) {
    todo.push(`Render {surfaceRoute() ?? <App />} with surfaceRoute from ${route}, or route /s/:token to <SurfaceScreen token={token} /> from ${screen}.`);
  }
}

function init() {
  if (!existsSync("package.json")) {
    console.error("No package.json here. Run `npx ui-calling init` in your project's root.");
    process.exit(1);
  }
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  if (isWorkspaceRoot(".") && !flag("--framework") && !force) {
    console.error("This is a monorepo root. Run `npx ui-calling init` in the app that serves your screens (e.g. apps/web), or pass --force.");
    process.exit(1);
  }
  const framework = flag("--framework", deps.next ? "next" : deps.vite ? "vite" : "other");
  const src = existsSync("src");
  const lib = flag("--dir", raw?.surfacesDir ?? (src ? "src/ui-calling" : "ui-calling"));
  if (raw && relative(raw.surfacesDir, lib) !== "" && !force) {
    // `new` registers in the files the config points at: two setups would leave one of them unused.
    console.error(`Already set up in ${raw.surfacesDir} (see ${CONFIG_FILE}). To move it, move those files and edit ${CONFIG_FILE}, or pass --force to set up again in ${lib}.`);
    process.exit(1);
  }
  const deliver = flag("--deliver", "button");
  // Next.js keeps server and browser code side by side; elsewhere `src/` is what gets bundled for the browser, so
  // the runtime (node:sqlite, process.env) and every .server.ts go in a server folder of their own.
  const serverLib = flag("--server-dir", raw?.serverDir ?? (framework === "next" ? lib : "server"));
  const runtime = join(serverLib, "ui.ts");
  const screen = join(lib, "surface-screen.tsx");
  console.log(`Setting up UI_calling for ${framework === "other" ? "your project" : framework === "next" ? "Next.js" : "Vite"}\n`);

  // Flags become string literals in ui.ts: escape them, so a quote can't break the file.
  const literal = (v) => JSON.stringify(String(v)).slice(1, -1);
  if (!["button", "message"].includes(deliver)) {
    console.error(`--deliver is "button" or "message", not "${deliver}".`);
    process.exit(1);
  }
  const devUrl = flag("--base-url", raw?.devUrl ?? (framework === "vite" ? "http://localhost:5173" : "http://localhost:3000"));
  write(runtime, fill("ui.ts", { __BASE_URL__: literal(devUrl), __DELIVER__: deliver }));
  // "use client" is a Next.js directive: elsewhere it only reads as if this were Next-only.
  write(screen, framework === "next" ? fill("surface-screen.tsx", {}) : fill("surface-screen.tsx", {}).replace(/^"use client";\n/, ""));
  // Next's dev server watches the project, so its development database lives in node_modules/.cache; elsewhere
  // .ui-calling/ (git-ignored) keeps it safe from a clean install.
  const storeCode = fill("store.ts", {});
  write(
    join(serverLib, "store.ts"),
    framework === "next"
      ? storeCode
      : storeCode
          .replace("or node_modules/.cache/ui-calling/ in development, where the\n * dev server doesn't watch it.", "or .ui-calling/dev.db in development.")
          .replace("sqliteStore();", `sqliteStore(process.env.NODE_ENV === "production" ? undefined : ".ui-calling/dev.db");`),
  );
  write(join(lib, "tokens.css"), readFileSync(join(registryDir, registry.tokens)));

  const done = [];
  if (framework === "next") {
    const app = existsSync("src/app") ? "src/app" : existsSync("app") ? "app" : src ? "src/app" : "app";
    const route = join(app, "api/ui/[...path]/route.ts");
    const page = join(app, "s/[token]/page.tsx");
    write(route, fill("next-route.ts", { __UI_IMPORT__: importPath(route, runtime) }));
    write(page, fill("next-page.tsx", { __SCREEN_IMPORT__: importPath(page, screen) }));
    done.push(`API routes at /api/ui (${route})`, `surface page at /s/[token] (${page})`);
    allowTunnelInNextDev(done);
  }
  const todo = [];
  if (framework === "vite") setUpVite({ lib, serverLib, runtime, screen, done, todo, pkg });

  writeFileSync(CONFIG_FILE, JSON.stringify({ framework, runtime, screen, surfacesDir: lib, serverDir: serverLib, devUrl }, null, 2) + "\n");
  console.log(`  write  ${CONFIG_FILE}`);

  // Point coding agents at the guide, in the instructions files they already read.
  const note = `\n<!-- ui-calling -->\n## UI_calling\n\nScreens the AI agent can open live in \`${lib}\`. To add one, run \`npx ui-calling new <name>\` and follow \`npx ui-calling guide\`.\n`;
  for (const f of ["AGENTS.md", "CLAUDE.md"]) {
    if (existsSync(f) && !readFileSync(f, "utf8").includes("<!-- ui-calling -->")) {
      appendFileSync(f, note);
      console.log(`  update ${f}`);
    }
  }

  // The production database lives in .ui-calling/ (in development it's under node_modules/.cache).
  if (existsSync(".gitignore") && !/^\/?\.ui-calling\/?$/m.test(readFileSync(".gitignore", "utf8"))) {
    appendFileSync(".gitignore", "\n# UI_calling's SQLite database\n.ui-calling/\n");
    console.log("  update .gitignore");
  }

  // Without the tokens, the screens' classes (bg-primary, text-muted-foreground...) style nothing.
  const tokensFile = join(lib, "tokens.css");
  const css = ["src/app/globals.css", "app/globals.css", "src/index.css", "src/styles.css", "src/globals.css", "styles/globals.css", "src/App.css"].find(
    (f) => existsSync(f) && /@import\s+["']tailwindcss["']/.test(readFileSync(f, "utf8")),
  );
  let tokensStep = `Import the design tokens after Tailwind in your global CSS: @import "<path to>/${tokensFile}";`;
  if (css) {
    let s = readFileSync(css, "utf8");
    const rel = importPath(css, tokensFile);
    if (!s.includes("tokens.css")) {
      s = s.replace(/(@import\s+["']tailwindcss["'];?)/, `$1\n@import "${rel}";`);
      writeFileSync(css, s);
      console.log(`  update ${css}`);
    }
    tokensStep = null;
    // Rules after the import win: a starter's own --background/--foreground replace UI_calling's.
    if (/:root\s*{[^}]*--(background|foreground)\s*:/.test(s)) {
      done.push(`tokens imported in ${css}, but its own --background/--foreground override them; delete those to use UI_calling's`);
    } else done.push(`tokens imported in ${css}`);
    // create-vite's starter page styles bare elements (#root, h1, p…) outside Tailwind's layers, so they win on the
    // screens too: a centered, oversized title.
    if (/^(#root|h1|h2|p|body)\s*\{/m.test(s)) {
      todo.push(`${css} still has starter styles for #root, h1, p…, which also style the screens. Remove them when you replace the starter page.`);
    }
  }

  const pm = existsSync("pnpm-lock.yaml") ? "pnpm add" : existsSync("yarn.lock") ? "yarn add" : existsSync("bun.lockb") || existsSync("bun.lock") ? "bun add" : "npm install";
  // Only what's missing. zod must be a direct dependency: contracts import it.
  const wanted = ["@ui-calling/core", "@ui-calling/server", "@ui-calling/react", "@ui-calling/sqlite", "zod", ...(framework === "vite" ? ["hono", "@hono/node-server", "tsx"] : [])];
  const missing = wanted.filter((d) => !deps[d]);
  const steps = [];
  if (missing.length) {
    const ours = missing.filter((d) => d.startsWith("@ui-calling/"));
    steps.push(
      `${pm} ${missing.join(" ")}` +
        // Until the first release, an install from the registry would fail, or find someone else's package.
        (ours.length ? `\n     Not on npm yet: install ${ours.join(", ")} from the tarballs built in the UI_calling repo (README, "Building and publishing").` : ""),
    );
  }
  if (tokensStep) steps.push(tokensStep);
  steps.push(...todo);
  if (framework === "vite") steps.push(`Run the API next to Vite: npm run dev:api (and npm run dev). Vite proxies /api to it.`);
  if (framework === "other") {
    steps.push(
      `Serve the API: mount uiCallingHandler(ui) from "@ui-calling/server" at /api/ui on your server (any framework that takes (Request) => Response; for Hono/Express-style apps, uiCallingRoutes(ui)).`,
      `Route /s/:token in your app to <SurfaceScreen token={token} /> from ${screen}.`,
    );
  }
  steps.push(
    `Give the tools to your agent: @ui-calling/anthropic, /ai-sdk, /openai or /mcp (see the guide).`,
    `Add your first screen: npx ui-calling new <name>`,
  );
  console.log(`\n${done.length ? `Done: ${done.join("; ")}.\n\n` : ""}Next:\n${steps.map((s, i) => `  ${i + 1}. ${s}`).join("\n")}\n\nGuide: npx ui-calling guide`);
}

/**
 * `link` and `events`: talk to the dev routes of a running dev server (`uiCallingHandler(ui, { dev: true })`,
 * which `init` sets up for `next dev`), so you can click through a screen without an agent.
 */
async function devCommand(which) {
  // Where the app runs: --url, else ui-calling.json's devUrl (init writes it), else the framework's default port.
  const fallback = config?.devUrl ?? `http://localhost:${config?.framework === "vite" ? 5173 : 3000}`;
  const from = flag("--url") ? "--url" : config?.devUrl ? `devUrl in ${CONFIG_FILE}` : "the default";
  // --url can be the app (http://localhost:3100) or its API (http://localhost:3100/api/ui).
  const given = new URL(flag("--url", fallback));
  const base = (given.pathname === "/" ? `${given.origin}/api/ui` : given.href).replace(/\/$/, "");
  const subject = flag("--subject", "dev-user");
  // Your agent's conversation, so the screen's events reach it (default: a conversation of its own, dev:<subject>).
  const conversationId = flag("--conversation", `dev:${subject}`);
  const reach = async (path, init) => {
    const res = await fetch(base + path, init).catch(() => null);
    if (!res) {
      console.error(`Couldn't reach ${base} (from ${from}). Start your dev server, or pass --url http://localhost:<port>; to remember it, set "devUrl" in ${CONFIG_FILE}.`);
      process.exit(1);
    }
    if (res.status === 404 && !path.startsWith("/dev/links")) {
      console.error(`${base}${path} isn't there. The dev routes need uiCallingHandler(ui, { dev: true }) in development (init sets this up for Next.js).`);
      process.exit(1);
    }
    return res;
  };
  if (which === "events") {
    // Same clock as your agent: pass the zone you give formatEventsForAgent (e.g. --time-zone Europe/Madrid).
    const tz = flag("--time-zone");
    const res = await reach(`/dev/events/${encodeURIComponent(conversationId)}${tz ? `?timeZone=${encodeURIComponent(tz)}` : ""}`);
    process.stdout.write((await res.text()) + "\n");
    return;
  }
  const [surface, ...pairs] = names;
  if (!surface) {
    console.error("Usage: ui-calling link <surface> [key=value...] [--subject id] [--conversation id] [--locale es] [--url http://localhost:3000]");
    process.exit(1);
  }
  // key=value pairs become the tool input; numbers and true/false keep their type.
  const input = Object.fromEntries(
    pairs.map((p) => {
      const [k, ...v] = p.split("=");
      const value = v.join("=");
      return [k, /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : value === "true" ? true : value === "false" ? false : value];
    }),
  );
  const res = await reach("/dev/links", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ surface: surface.replaceAll("-", "_"), input, subject, conversationId, locale: flag("--locale") }),
  });
  const json = await res.json().catch(() => ({ message: `${base}/dev/links isn't there. The dev routes need uiCallingHandler(ui, { dev: true }) in development (init sets this up for Next.js).` }));
  if (!res.ok) {
    // A refusal from resolve: say which, and the usual cause (the test user isn't linked to anyone yet).
    if (json.error && json.error !== "unknown_surface" && json.error !== "invalid_payload" && res.status === 422) {
      console.error(`The screen refused subject "${subject}": ${json.error}: ${json.message}`);
      console.error(`In development, give "${subject}" a test account at startup (with the link-account block: identity.link("${subject}", "<customer id>")), or pass --subject <a linked subject>.`);
    } else console.error(json.message ?? json.error ?? `HTTP ${res.status}`);
    process.exit(1);
  }
  console.log(json.url);
  // The link's address comes from the app's baseUrl (PUBLIC_URL): say so when it isn't the server we just talked to.
  if (new URL(json.url).origin !== new URL(base).origin) {
    console.log(`\nNote: this link points at ${new URL(json.url).origin}, but your dev server answered at ${new URL(base).origin}. Set PUBLIC_URL=${new URL(base).origin} for the app, or open it at ${new URL(base).origin}${new URL(json.url).pathname}.`);
  }
  const again = [conversationId !== `dev:${subject}` ? `--conversation ${conversationId}` : subject !== "dev-user" ? `--subject ${subject}` : ""].filter(Boolean).join(" ");
  console.log(`\nOpened for subject "${subject}" in conversation "${conversationId}". What the agent reads back: npx ui-calling events${again ? ` ${again}` : ""}`);
}

/**
 * Recipes link to demo and package files by relative path, which works in the repo but goes nowhere from the
 * CLI: print them as GitHub links instead. Links to other recipes (x.md) stay as they are.
 */
function repoLinks(md) {
  return md.replace(/\]\((\.\.\/[^)#]+)\)/g, (_, rel) => `](https://github.com/pausanchez/ui_calling/blob/main/${posix.normalize(posix.join("packages/cli/recipes", rel))})`);
}

// `<command> --help` shows the usage instead of running the command.
switch (rest.includes("--help") || rest.includes("-h") ? "help" : cmd) {
  case "init":
    init();
    break;
  case "list":
    console.log("Blocks: finished screens (contract, screen, server)");
    for (const [name, b] of Object.entries(registry.blocks)) console.log(`  ${name.padEnd(18)} ${b.description}`);
    console.log("\nParts: pieces to build screens from, copied into <dir>/parts/");
    for (const [name, p] of Object.entries(registry.parts)) console.log(`  ${name.padEnd(18)} ${p.description}`);
    console.log("\nAdd either with: npx ui-calling add <name>");
    break;
  case "tokens":
    copy(registry.tokens);
    console.log(`\nImport it after Tailwind in your CSS:\n  @import "tailwindcss";\n  @import "./components/ui-calling/tokens.css";`);
    break;
  case "add": {
    if (!names.length) {
      console.error("Usage: ui-calling add <block or part...> [--dir path] [--server-dir path] [--force]");
      process.exit(1);
    }
    refuseWorkspaceRoot("add");
    const deps = new Set();
    const unregistered = [];
    let wroteServer = false;
    for (const name of names) {
      if (registry.parts[name]) {
        console.log(name);
        addPart(name).dependencies.forEach((d) => deps.add(d));
        continue;
      }
      const block = registry.blocks[name];
      if (!block) {
        console.error(`Unknown block or part "${name}". Run "ui-calling list".`);
        process.exit(1);
      }
      console.log(name);
      block.files.forEach(copy);
      block.dependencies.forEach((d) => deps.add(d));
      if (!block.server) continue;
      // Blocks import init's store from the registry (so the repo typechecks them); in your project it's ui-calling/store.ts.
      const libDir = config?.runtime ? dirname(config.runtime) : outDir;
      const storeFile = join(libDir, "store.ts");
      // Support files (e.g. identity.ts) go next to store.ts, for the whole app to import: written once, like the server file.
      const support = (block.support ?? []).map((rel) => ({ rel, target: join(libDir, basename(rel)) }));
      for (const { rel, target } of support) {
        if (existsSync(target) && !replace) console.log(`  keep   ${shown(target)} (yours now; --replace writes the block's again)`);
        else writeOver(target, readFileSync(join(registryDir, rel), "utf8").replaceAll(`"../../../templates/init/store"`, `"${importPath(target, storeFile)}"`));
      }
      // The server file is where your data comes from: written once, never overwritten, even with --force (--replace does).
      const serverFile = join(serverDir, basename(block.server));
      const contract = block.files.find((f) => f.endsWith(".surface.ts"));
      if (existsSync(serverFile) && !replace) console.log(`  keep   ${shown(serverFile)} (your data code; --replace writes the example again)`);
      else {
        let s = readFileSync(join(registryDir, block.server), "utf8")
          .replaceAll(`"./${basename(contract, ".ts")}"`, `"${importPath(serverFile, join(outDir, basename(contract)))}"`)
          .replaceAll(`"../../../templates/init/store"`, `"${importPath(serverFile, storeFile)}"`);
        for (const { rel, target } of support) s = s.replaceAll(`"./${basename(rel, ".ts")}"`, `"${importPath(serverFile, target)}"`);
        wroteServer = writeOver(serverFile, s);
      }
      const screenFile = join(outDir, basename(block.files.find((f) => f.endsWith(".tsx"))));
      // --identifier: what users type to be found (link-account). The screen is registered with it.
      const identifier = flag("--identifier");
      const kinds = block.options?.identifier;
      if (identifier && !kinds?.includes(identifier)) {
        console.error(kinds ? `--identifier is ${kinds.join(", ")}, not "${identifier}".` : `${name} has no --identifier.`);
        process.exit(1);
      }
      if (!registerSurface(block.register, serverFile, screenFile, identifier && identifier !== "email" ? ` identifier="${identifier}"` : "")) unregistered.push(block);
    }
    if (deps.size) console.log(`\nMake sure these are installed: ${[...deps].join(" ")}`);
    for (const { register: r } of unregistered) {
      console.log(`Register it: createUiCalling({ surfaces: [${r.impl}, ...] }), and render <${r.component} /> for "${r.surface}" on your surface route.`);
    }
    if (wroteServer) console.log(`Then load real data in the .server.ts file: it ships with an example so the screen renders.`);
    break;
  }
  case "new":
    refuseWorkspaceRoot("new");
    if (names.length !== 1) {
      console.error("Usage: ui-calling new <name> [--template surface|steps] [--dir path] [--server-dir path] [--force]");
      process.exit(1);
    }
    newSurface(names[0]);
    break;
  case "whatsapp": {
    const { whatsapp } = await import("./whatsapp.mjs");
    await whatsapp(names[0], { flag, devCommand: passThrough, defaultPort: config?.framework === "vite" ? "5173" : "3000" });
    break;
  }
  case "link":
  case "events":
    await devCommand(cmd);
    break;
  case "guide": {
    // `guide` is the whole guide; `guide recipes` lists the recipes; `guide <recipe>` prints one.
    const recipesDir = join(pkgDir, "recipes");
    const recipes = readdirSync(recipesDir).filter((f) => f.endsWith(".md") && f !== "README.md").map((f) => f.slice(0, -3));
    const [topic] = names;
    const guide = readFileSync(join(pkgDir, "GUIDE.md"), "utf8");
    // The guide's sections, by their ## heading: `guide toc` lists them, `guide <section>` prints one. A ### heading
    // works too (guide vite), printing just that part.
    const slug = (title) => title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const cut = (level) =>
      guide.split(new RegExp(`^(?=#{${level}} )`, "m")).flatMap((text) => {
        const title = text.match(new RegExp(`^#{${level}} (.*)`))?.[1].replace(/`/g, "");
        return title ? [{ title, slug: slug(title), text: level === 3 ? text.split(/^(?=## )/m)[0] : text }] : [];
      });
    const sections = cut(2);
    const parts = [...sections, ...cut(3)];
    const word = topic?.toLowerCase();
    const section = topic && (parts.find((x) => x.slug === word) ?? parts.find((x) => x.slug.split("-").includes(word)));
    if (!topic) process.stdout.write(guide);
    else if (topic === "toc") {
      console.log("Sections (npx ui-calling guide <section>, or one word of it, e.g. guide agent):\n");
      for (const x of sections) console.log(`  ${x.slug.padEnd(38)} ${x.title}`);
      console.log(`\nRecipes (npx ui-calling guide <recipe>): ${recipes.join(", ")}`);
    } else if (topic === "recipes") process.stdout.write(readFileSync(join(recipesDir, "README.md"), "utf8"));
    else if (recipes.includes(topic)) process.stdout.write(repoLinks(readFileSync(join(recipesDir, `${topic}.md`), "utf8")));
    else if (section) process.stdout.write(section.text);
    else {
      console.error(`No section or recipe "${topic}". See npx ui-calling guide toc.`);
      process.exit(1);
    }
    break;
  }
  default:
    console.log(`ui-calling <command>

  init              set up UI_calling in this project (detects Next.js or Vite)
                    --dir (default src/ui-calling or ui-calling), --server-dir (default: the same
                    for Next.js, server/ otherwise), --deliver button|message,
                    --framework next|vite|other, --base-url (your dev address, e.g. http://localhost:5173)
  new <name>        scaffold a surface (contract, screen, server) and register it
                    --template steps: a screen with several steps, a saved draft and Back
                    --dir, --server-dir (default: from ui-calling.json)
  add <block...>    copy ready-made blocks and register them; their .server.ts is written once,
                    never overwritten (--dir, --server-dir, --force; --replace rewrites everything,
                    server file included, to swap your own screen for the block).
                    link-account: --identifier email|tel|text, what users type to be found
  list              show available blocks
  tokens            copy the design tokens only
  link <surface> [key=value...]
                    open a screen for a test user on your running dev server and print its link,
                    e.g. link order-return order_id=A-0987. The test user's subject is
                    dev-user unless you pass --subject. --url is your app (http://localhost:3100)
                    or its API; --conversation puts the screen in your agent's conversation
  events            print what the agent would read from that test user's screens
                    (--subject, --conversation, --url, --time-zone Europe/Madrid)
  whatsapp check    is the WhatsApp setup right? (token, where Meta delivers; --url, --webhook-path)
  whatsapp dev      tunnel + your dev server with PUBLIC_URL + point Meta's webhook there
                    (--port 3000, --webhook-path /api/whatsapp/webhook, -- your dev command)
  guide             print the guide for building surfaces (for people and coding agents)
  guide toc         list its sections and the recipes; "guide <section>" prints one section
                    (a word is enough: guide vite, guide testing), "guide <recipe>" one recipe`);
}
