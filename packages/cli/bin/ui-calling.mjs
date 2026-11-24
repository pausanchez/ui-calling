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
const config = existsSync(CONFIG_FILE) ? JSON.parse(readFileSync(CONFIG_FILE, "utf8")) : null;

const VALUE_FLAGS = ["--dir", "--server-dir", "--framework", "--deliver", "--base-url"];
const [cmd, ...rest] = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = rest.indexOf(name);
  return i >= 0 ? rest[i + 1] : fallback;
};
const force = rest.includes("--force");
const outDir = resolve(flag("--dir", config?.surfacesDir ?? "src/components/ui-calling"));
const serverDir = resolve(flag("--server-dir", config?.serverDir ?? flag("--dir", config?.surfacesDir ?? "src/components/ui-calling")));
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
  console.log(`  update ${file}`);
  return true;
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
  const inRuntime = register(config?.runtime, `import { ${vars.__const__}Impl } from "${importPath(config?.runtime ?? ".", serverFile)}";`, `${vars.__const__}Impl,`);
  const inScreen = register(config?.screen, `import { ${vars.__Component__} } from "${importPath(config?.screen ?? ".", screenFile)}";`, `${vars.__surface__}: () => <${vars.__Component__} />,`);
  const registered = inRuntime && inScreen;

  console.log(`
Next:
  1. Fill the TODOs in ${name}.surface.ts: description, input, data, events.
  2. Load real data in ${name}.server.ts.${
    registered
      ? `\n  3. Already registered in ${config.runtime} and ${config.screen}.`
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
  const framework = flag("--framework", deps.next ? "next" : deps.vite ? "vite" : "other");
  const src = existsSync("src");
  const lib = flag("--dir", src ? "src/ui-calling" : "ui-calling");
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
    `${pm} @ui-calling/core @ui-calling/server @ui-calling/react zod`,
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
      console.error("Usage: ui-calling add <block...> [--dir path] [--force]");
      process.exit(1);
    }
    const deps = new Set();
    for (const name of names) {
      const block = registry.blocks[name];
      if (!block) {
        console.error(`Unknown block "${name}". Run "ui-calling list".`);
        process.exit(1);
      }
      console.log(name);
      block.files.forEach(copy);
      block.dependencies.forEach((d) => deps.add(d));
    }
    console.log(`\nMake sure these are installed: ${[...deps].join(" ")}`);
    break;
  }
  case "new":
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
  add <block...>    copy ready-made blocks into --dir
  list              show available blocks
  tokens            copy the design tokens only
  guide             print the guide for building surfaces (for people and coding agents)`);
}
