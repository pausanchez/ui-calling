#!/usr/bin/env node
// ui-calling: set up UI_calling in a project and copy surfaces into it. You own the code afterwards.
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const registryDir = join(pkgDir, "registry");
const surfaceTemplates = join(pkgDir, "templates", "surface");
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

const VALUE_FLAGS = ["--dir", "--server-dir", "--framework", "--deliver", "--base-url"];
const [cmd, ...rest] = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = rest.indexOf(name);
  return i >= 0 ? rest[i + 1] : fallback;
};
const force = rest.includes("--force");
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
  if (existsSync(target) && !force) {
    console.log(`  skip   ${relative(process.cwd(), target)} (exists, use --force to overwrite)`);
    return false;
  }
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
  console.log(`  write  ${relative(process.cwd(), target)}`);
  return true;
}

function copy(rel) {
  write(join(outDir, basename(rel)), readFileSync(join(registryDir, rel)));
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
  const serverFile = join(serverDir, `${name}.server.ts`);
  const screenFile = join(outDir, `${name}.tsx`);

  for (const file of readdirSync(surfaceTemplates)) {
    const isServer = file.endsWith(".server.ts");
    let content = readFileSync(join(surfaceTemplates, file), "utf8");
    // Only the server file may live elsewhere; the screen sits next to its contract.
    if (isServer) content = content.replaceAll('"./__name__.surface"', `"${importPath(serverFile, join(outDir, `${name}.surface.ts`))}"`);
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

  write(runtime, fill("ui.ts", { __BASE_URL__: flag("--base-url", framework === "vite" ? "http://localhost:5173" : "http://localhost:3000"), __DELIVER__: deliver }));
  write(screen, fill("surface-screen.tsx", {}));
  write(join(lib, "tokens.css"), readFileSync(join(registryDir, registry.tokens)));

  const done = [];
  if (framework === "next") {
    const app = existsSync("src/app") ? "src/app" : existsSync("app") ? "app" : src ? "src/app" : "app";
    const route = join(app, "api/ui/[...path]/route.ts");
    const page = join(app, "s/[token]/page.tsx");
    write(route, fill("next-route.ts", { __UI_IMPORT__: importPath(route, runtime) }));
    write(page, fill("next-page.tsx", { __SCREEN_IMPORT__: importPath(page, screen) }));
    done.push(`API routes at /api/ui (${route})`, `surface page at /s/[token] (${page})`);
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

  const pm = existsSync("pnpm-lock.yaml") ? "pnpm add" : existsSync("yarn.lock") ? "yarn add" : existsSync("bun.lockb") || existsSync("bun.lock") ? "bun add" : "npm install";
  const steps = [
    `${pm} @ui-calling/core @ui-calling/server @ui-calling/react @ui-calling/sqlite zod`,
    `Add .ui-calling/ to your .gitignore: it holds the SQLite database.`,
    `Import the design tokens after Tailwind in your global CSS: @import "<path to>/${join(lib, "tokens.css")}";`,
  ];
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

switch (cmd) {
  case "init":
    init();
    break;
  case "list":
    for (const [name, b] of Object.entries(registry.blocks)) console.log(`${name.padEnd(16)} ${b.description}`);
    break;
  case "tokens":
    copy(registry.tokens);
    console.log(`\nImport it after Tailwind in your CSS:\n  @import "tailwindcss";\n  @import "./components/ui-calling/tokens.css";`);
    break;
  case "add": {
    if (!names.length) {
      console.error("Usage: ui-calling add <block...> [--dir path] [--server-dir path] [--force]");
      process.exit(1);
    }
    refuseWorkspaceRoot("add");
    const deps = new Set();
    const unregistered = [];
    let wroteServer = false;
    for (const name of names) {
      const block = registry.blocks[name];
      if (!block) {
        console.error(`Unknown block "${name}". Run "ui-calling list".`);
        process.exit(1);
      }
      console.log(name);
      block.files.forEach(copy);
      block.dependencies.forEach((d) => deps.add(d));
      if (!block.server) continue;
      // The server file is where your data comes from: written once, never overwritten, even with --force.
      const serverFile = join(serverDir, basename(block.server));
      const contract = block.files.find((f) => f.endsWith(".surface.ts"));
      if (existsSync(serverFile)) console.log(`  keep   ${shown(serverFile)} (your data code; delete it to get the example again)`);
      else {
        const s = readFileSync(join(registryDir, block.server), "utf8");
        wroteServer = write(serverFile, s.replaceAll(`"./${basename(contract, ".ts")}"`, `"${importPath(serverFile, join(outDir, basename(contract)))}"`));
      }
      const screenFile = join(outDir, basename(block.files.find((f) => f.endsWith(".tsx"))));
      if (!registerSurface(block.register, serverFile, screenFile)) unregistered.push(block);
    }
    console.log(`\nMake sure these are installed: ${[...deps].join(" ")}`);
    for (const { register: r } of unregistered) {
      console.log(`Register it: createUiCalling({ surfaces: [${r.impl}, ...] }), and render <${r.component} /> for "${r.surface}" on your surface route.`);
    }
    if (wroteServer) console.log(`Then load real data in the .server.ts file: it ships with an example so the screen renders.`);
    break;
  }
  case "new":
    refuseWorkspaceRoot("new");
    if (names.length !== 1) {
      console.error("Usage: ui-calling new <name> [--dir path] [--server-dir path] [--force]");
      process.exit(1);
    }
    newSurface(names[0]);
    break;
  case "guide":
    process.stdout.write(readFileSync(join(pkgDir, "GUIDE.md"), "utf8"));
    break;
  default:
    console.log(`ui-calling <command>

  init              set up UI_calling in this project (detects Next.js or Vite)
                    --dir (default src/ui-calling or ui-calling), --deliver button|message,
                    --framework next|vite|other, --base-url
  new <name>        scaffold a surface (contract, screen, server) and register it
                    --dir, --server-dir (default: from ui-calling.json)
  add <block...>    copy ready-made blocks and register them; their .server.ts is written once,
                    never overwritten (--dir, --server-dir, --force)
  list              show available blocks
  tokens            copy the design tokens only
  guide             print the guide for building surfaces (for people and coding agents)`);
}
