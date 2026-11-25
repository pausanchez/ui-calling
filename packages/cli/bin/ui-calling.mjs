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

const VALUE_FLAGS = ["--dir", "--server-dir", "--framework", "--deliver", "--base-url", "--template", "--subject", "--locale", "--url", "--time-zone", "--conversation", "--port", "--webhook-path"];
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
  if (!s.includes(entry)) s = s.replace("/* ui-calling:surfaces */", `${entry} /* ui-calling:surfaces */`);
  writeFileSync(file, s);
  console.log(`  update ${shown(file)}`);
  return true;
}

/** Register a surface's implementation in the runtime and its component in the screen, if `init` made them. */
function registerSurface({ impl, component, surface }, serverFile, screenFile) {
  const inRuntime = register(config?.runtime, `import { ${impl} } from "${importPath(config?.runtime ?? ".", serverFile)}";`, `${impl},`);
  const inScreen = register(config?.screen, `import { ${component} } from "${importPath(config?.screen ?? ".", screenFile)}";`, `${surface}: () => <${component} />,`);
  return inRuntime && inScreen;
}

function newSurface(name) {
  if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(name)) {
    console.error(`"${name}" isn't a valid name. Use kebab-case, e.g. shift-picker.`);
    process.exit(1);
  }
  const words = name.split("-");
  const cap = (w) => w[0].toUpperCase() + w.slice(1);
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

  for (const file of readdirSync(templateDir)) {
    const isServer = file.endsWith(".server.ts");
    let content = readFileSync(join(templateDir, file), "utf8");
    // Only the server file may live elsewhere; the screen sits next to its contract.
    if (isServer) content = content.replaceAll('"./__name__.surface"', `"${importPath(serverFile, join(outDir, `${name}.surface.ts`))}"`);
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
  const runtime = join(lib, "ui.ts");
  const screen = join(lib, "surface-screen.tsx");
  console.log(`Setting up UI_calling for ${framework === "other" ? "your project" : framework === "next" ? "Next.js" : "Vite"}\n`);

  // Flags become string literals in ui.ts: escape them, so a quote can't break the file.
  const literal = (v) => JSON.stringify(String(v)).slice(1, -1);
  if (!["button", "message"].includes(deliver)) {
    console.error(`--deliver is "button" or "message", not "${deliver}".`);
    process.exit(1);
  }
  write(runtime, fill("ui.ts", { __BASE_URL__: literal(flag("--base-url", framework === "vite" ? "http://localhost:5173" : "http://localhost:3000")), __DELIVER__: deliver }));
  write(screen, fill("surface-screen.tsx", {}));
  write(join(lib, "store.ts"), fill("store.ts", {}));
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

  writeFileSync(CONFIG_FILE, JSON.stringify({ framework, runtime, screen, surfacesDir: lib, serverDir: lib }, null, 2) + "\n");
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
  }

  const pm = existsSync("pnpm-lock.yaml") ? "pnpm add" : existsSync("yarn.lock") ? "yarn add" : existsSync("bun.lockb") || existsSync("bun.lock") ? "bun add" : "npm install";
  // Only what's missing. zod must be a direct dependency: contracts import it.
  const missing = ["@ui-calling/core", "@ui-calling/server", "@ui-calling/react", "@ui-calling/sqlite", "zod"].filter((d) => !deps[d]);
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
  if (framework !== "next") {
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
  const port = config?.framework === "vite" ? 5173 : 3000;
  // --url can be the app (http://localhost:3100) or its API (http://localhost:3100/api/ui).
  const given = new URL(flag("--url", `http://localhost:${port}`));
  const base = (given.pathname === "/" ? `${given.origin}/api/ui` : given.href).replace(/\/$/, "");
  const subject = flag("--subject", "dev-user");
  // Your agent's conversation, so the screen's events reach it (default: a conversation of its own, dev:<subject>).
  const conversationId = flag("--conversation", `dev:${subject}`);
  const reach = async (path, init) => {
    const res = await fetch(base + path, init).catch(() => null);
    if (!res) {
      console.error(`Couldn't reach ${base}. Start your dev server, or pass --url (e.g. --url http://localhost:3001/api/ui).`);
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
    console.error(json.message ?? json.error ?? `HTTP ${res.status}`);
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

switch (cmd) {
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
      if (!registerSurface(block.register, serverFile, screenFile)) unregistered.push(block);
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
    if (!topic) process.stdout.write(readFileSync(join(pkgDir, "GUIDE.md"), "utf8"));
    else if (topic === "recipes") process.stdout.write(readFileSync(join(recipesDir, "README.md"), "utf8"));
    else if (recipes.includes(topic)) process.stdout.write(repoLinks(readFileSync(join(recipesDir, `${topic}.md`), "utf8")));
    else {
      console.error(`No recipe "${topic}". Recipes: ${recipes.join(", ")}`);
      process.exit(1);
    }
    break;
  }
  default:
    console.log(`ui-calling <command>

  init              set up UI_calling in this project (detects Next.js or Vite)
                    --dir (default src/ui-calling or ui-calling), --deliver button|message,
                    --framework next|vite|other, --base-url
  new <name>        scaffold a surface (contract, screen, server) and register it
                    --template steps: a screen with several steps, a saved draft and Back
                    --dir, --server-dir (default: from ui-calling.json)
  add <block...>    copy ready-made blocks and register them; their .server.ts is written once,
                    never overwritten (--dir, --server-dir, --force; --replace rewrites everything,
                    server file included, to swap your own screen for the block)
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
  guide [recipe]    print the guide for building surfaces (for people and coding agents);
                    "guide recipes" lists task-shaped recipes, "guide <recipe>" prints one`);
}
