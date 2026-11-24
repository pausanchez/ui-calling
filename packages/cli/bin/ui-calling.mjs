#!/usr/bin/env node
// ui-calling: copy surfaces and tokens into your project. You own the code afterwards.
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const registryDir = join(dirname(fileURLToPath(import.meta.url)), "..", "registry");
const registry = JSON.parse(readFileSync(join(registryDir, "registry.json"), "utf8"));

const [cmd, ...rest] = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = rest.indexOf(name);
  return i >= 0 ? rest[i + 1] : fallback;
};
const force = rest.includes("--force");
const outDir = resolve(flag("--dir", "src/components/ui-calling"));
const names = rest.filter((a, i) => !a.startsWith("--") && !rest[i - 1]?.startsWith("--dir"));

function copy(rel) {
  const target = join(outDir, basename(rel));
  if (existsSync(target) && !force) {
    console.log(`  skip   ${target} (exists, use --force to overwrite)`);
    return;
  }
  mkdirSync(outDir, { recursive: true });
  copyFileSync(join(registryDir, rel), target);
  console.log(`  write  ${target}`);
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
  default:
    console.log("ui-calling <command>\n\n  init              copy design tokens\n  add <block...>    copy blocks into --dir (default src/components/ui-calling)\n  list              show available blocks");
}
