#!/usr/bin/env node
// ui-calling: copy surfaces and tokens into your project. You own the code afterwards.
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const registryDir = join(pkgDir, "registry");
const templatesDir = join(pkgDir, "templates", "surface");
const registry = JSON.parse(readFileSync(join(registryDir, "registry.json"), "utf8"));

const VALUE_FLAGS = ["--dir", "--server-dir"];
const [cmd, ...rest] = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = rest.indexOf(name);
  return i >= 0 ? rest[i + 1] : fallback;
};
const force = rest.includes("--force");
const outDir = resolve(flag("--dir", "src/components/ui-calling"));
const serverDir = resolve(flag("--server-dir", flag("--dir", "src/components/ui-calling")));
const names = rest.filter((a, i) => !a.startsWith("--") && !VALUE_FLAGS.includes(rest[i - 1]));

function write(target, content) {
  if (existsSync(target) && !force) {
    console.log(`  skip   ${target} (exists, use --force to overwrite)`);
    return;
  }
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
  console.log(`  write  ${target}`);
}

function copy(rel) {
  write(join(outDir, basename(rel)), readFileSync(join(registryDir, rel)));
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
  // The server file may live elsewhere (e.g. server/), so point its import at the contract.
  let contractImport = relative(serverDir, join(outDir, `${name}.surface`)).split(sep).join("/");
  if (!contractImport.startsWith(".")) contractImport = `./${contractImport}`;

  for (const file of readdirSync(templatesDir)) {
    let content = readFileSync(join(templatesDir, file), "utf8").replaceAll('"./__name__.surface"', `"${contractImport}"`);
    for (const [key, value] of Object.entries(vars)) content = content.replaceAll(key, value);
    const dir = file.endsWith(".server.ts") ? serverDir : outDir;
    write(join(dir, file.replace("__name__", name)), content);
  }

  console.log(`
Next:
  1. Fill the TODOs in ${name}.surface.ts: description, input, data, events.
  2. Load real data in ${name}.server.ts and register it:
       createUiCalling({ surfaces: [${vars.__const__}Impl, ...] })
  3. Render <${vars.__Component__} /> inside <SurfaceProvider> on your surface route.
  4. Run your typechecker: it points at anything left to change.

Patterns and rules: npx ui-calling guide`);
}

switch (cmd) {
  case "list":
    for (const [name, b] of Object.entries(registry.blocks)) console.log(`${name.padEnd(16)} ${b.description}`);
    break;
  case "init":
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

  new <name>        scaffold a surface: contract, screen and server implementation
                    --dir (default src/components/ui-calling), --server-dir (default: --dir)
  add <block...>    copy ready-made blocks into --dir
  list              show available blocks
  init              copy design tokens
  guide             print the guide for building surfaces (for people and coding agents)`);
}
