// Runs the CLI the way a developer (or coding agent) would, in throwaway projects, and typechecks the result.
// Layouts deliberately differ in depth: an import path that's only right by accident fails here.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const tmp = join(root, ".tmp-cli-test");
const cli = join(root, "packages/cli/bin/ui-calling.mjs");
const run = (cwd, ...args) => execFileSync("node", [cli, ...args], { cwd, stdio: "pipe" }).toString();
const fails = (cwd, ...args) => {
  try {
    run(cwd, ...args);
  } catch (e) {
    return e.stderr.toString();
  }
  assert.fail(`expected "ui-calling ${args.join(" ")}" to fail`);
};
const read = (...p) => readFileSync(join(tmp, ...p), "utf8");

function project(name, pkg, dirs = [], files = {}) {
  const dir = join(tmp, name);
  for (const d of ["", ...dirs]) mkdirSync(join(dir, d), { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify(pkg));
  for (const [f, s] of Object.entries(files)) writeFileSync(join(dir, f), s);
  return dir;
}

rmSync(tmp, { recursive: true, force: true });
try {
  // `new` on its own, in three layouts (no ui-calling.json).
  for (const [name, args] of [
    ["new-same-dir", ["--dir", "components"]],
    ["new-server-shallower", ["--dir", "src/components/ui-calling", "--server-dir", "server"]],
    ["new-server-deeper", ["--dir", "ui", "--server-dir", "server/api/surfaces"]],
  ]) {
    run(project(name, {}), "new", "shift-picker", ...args);
    console.log(`generated  ${name}`);
  }

  // `init` then `new`, in the project shapes people have.
  const next = project("init-next-src", { dependencies: { next: "15" } }, ["src/app"], {
    "AGENTS.md": "# Agents\n",
    ".gitignore": "node_modules\n",
    "src/app/globals.css": '@import "tailwindcss";\n\n:root {\n  --background: #ffffff;\n}\n',
    // .mjs: the generated .ts files are typechecked, and the repo doesn't install next.
    "next.config.mjs": "/** @type {import('next').NextConfig} */\nconst nextConfig = {\n  reactStrictMode: true,\n};\n\nexport default nextConfig;\n",
  });
  const out = run(next, "init");
  assert.match(out, /Next\.js/);
  // The tokens go in right after Tailwind, and the starter's own --background is pointed out.
  assert.match(read("init-next-src", "src/app/globals.css"), /@import "tailwindcss";\n@import "\.\.\/ui-calling\/tokens\.css";/);
  assert.match(out, /override them/);
  assert.match(read("init-next-src", ".gitignore"), /^\.ui-calling\/$/m);
  // The store is its own file, so server code can use store.db without importing ui.ts.
  assert.match(read("init-next-src", "src/ui-calling/store.ts"), /export const store = sqliteStore\(\)/);
  assert.match(read("init-next-src", "src/ui-calling/ui.ts"), /import \{ store \} from "\.\/store";/);
  run(next, "new", "shift-picker");
  run(next, "new", "link-account");
  run(next, "new", "shift-picker"); // again: files are skipped, registration stays single
  const runtime = read("init-next-src", "src/ui-calling/ui.ts");
  assert.equal(runtime.match(/shiftPickerImpl,/g)?.length, 1, "registered once");
  assert.match(runtime, /linkAccountImpl,/);
  const screen = read("init-next-src", "src/ui-calling/surface-screen.tsx");
  assert.match(screen, /shift_picker: \(\) => <ShiftPicker \/>/);
  assert.match(read("init-next-src", "src/app/api/ui/[...path]/route.ts"), /from "\.\.\/\.\.\/\.\.\/\.\.\/ui-calling\/ui"/);
  assert.equal(read("init-next-src", "AGENTS.md").match(/<!-- ui-calling -->/g)?.length, 1);
  run(next, "init"); // re-running init doesn't clobber or duplicate
  assert.equal(read("init-next-src", "AGENTS.md").match(/<!-- ui-calling -->/g)?.length, 1);
  assert.equal(read("init-next-src", "src/app/globals.css").match(/tokens\.css/g)?.length, 1);
  assert.equal(read("init-next-src", ".gitignore").match(/\.ui-calling/g)?.length, 1);
  // A phone opens screens through a tunnel: next dev must serve its scripts to PUBLIC_URL's host. Added once.
  assert.equal(read("init-next-src", "next.config.mjs").match(/allowedDevOrigins: process\.env\.PUBLIC_URL/g)?.length, 1);
  assert.match(read("init-next-src", "src/ui-calling/ui.ts"), /shiftPickerImpl,/, "init without --force keeps registrations");
  // A block brings its server file and is registered; re-adding it updates the screen, never your data code.
  run(next, "add", "order-status");
  assert.match(read("init-next-src", "src/ui-calling/ui.ts"), /orderStatusImpl,/);
  assert.match(read("init-next-src", "src/ui-calling/surface-screen.tsx"), /order_status: \(\) => <OrderStatus \/>/);
  writeFileSync(join(next, "src/ui-calling/order-status.server.ts"), read("init-next-src", "src/ui-calling/order-status.server.ts") + "// mine\n");
  assert.match(run(next, "add", "order-status", "--force"), /keep/);
  assert.match(read("init-next-src", "src/ui-calling/order-status.server.ts"), /\/\/ mine/);
  assert.equal(read("init-next-src", "src/ui-calling/ui.ts").match(/orderStatusImpl,/g)?.length, 1, "registered once");
  // From a subfolder, `new` still finds ui-calling.json and registers in the files it names.
  run(join(next, "src/app"), "new", "payslip");
  assert.match(read("init-next-src", "src/ui-calling/ui.ts"), /payslipImpl,/);
  assert.match(read("init-next-src", "src/ui-calling/payslip.tsx"), /Payslip/);
  // A screen with several steps brings the parts it uses; parts can also be added on their own.
  run(next, "new", "claim-form", "--template", "steps");
  assert.match(read("init-next-src", "src/ui-calling/claim-form.tsx"), /from "\.\/parts\/step-bar"/);
  assert.match(read("init-next-src", "src/ui-calling/parts/action-bar.tsx"), /export function ActionBar/);
  assert.match(read("init-next-src", "src/ui-calling/ui.ts"), /claimFormImpl,/);
  assert.match(run(next, "add", "step-bar", "photo-picker", "quantity-stepper"), /keep .*step-bar\.tsx/);
  assert.match(read("init-next-src", "src/ui-calling/parts/photo-picker.tsx"), /export function PhotoPicker/);
  assert.match(fails(next, "new", "x", "--template", "nope"), /Unknown template/);
  // A name the template already uses for a variable would generate code that doesn't compile.
  assert.match(fails(next, "new", "note"), /clashes with a name/);
  // Setting up again somewhere else would leave the registrations behind.
  assert.match(fails(next, "init", "--dir", "lib/ui"), /Already set up in src\/ui-calling/);
  console.log("generated  init-next-src (+4 surfaces)");

  const nextRoot = project("init-next-app", { dependencies: { next: "15" } }, ["app"]);
  run(nextRoot, "init", "--deliver", "message");
  run(nextRoot, "new", "payslip");
  assert.match(read("init-next-app", "ui-calling/ui.ts"), /deliverLinks: "message"/);
  // The link-account block's server uses init's store; its import is pointed at this project's store.ts.
  run(nextRoot, "add", "link-account", "--server-dir", "server");
  assert.match(read("init-next-app", "server/link-account.server.ts"), /from "\.\.\/ui-calling\/identity";/);
  assert.match(read("init-next-app", "ui-calling/identity.ts"), /from "\.\/store";/);
  // --replace swaps your own server file for the block's; without it, yours stays.
  writeFileSync(join(nextRoot, "server/link-account.server.ts"), "// mine\n");
  assert.match(run(nextRoot, "add", "link-account", "--server-dir", "server"), /keep .*link-account\.server\.ts/);
  run(nextRoot, "add", "link-account", "--server-dir", "server", "--replace");
  assert.match(read("init-next-app", "server/link-account.server.ts"), /linkAccountImpl/);
  assert.match(read("init-next-app", "ui-calling/ui.ts"), /linkAccountImpl,/);
  console.log("generated  init-next-app (+1 surface, +1 block)");

  const vite = project("init-vite", { devDependencies: { vite: "7" } });
  assert.match(run(vite, "init"), /uiCallingHandler/);
  run(vite, "new", "order-tracker");
  console.log("generated  init-vite (+1 surface)");

  // A monorepo root isn't an app: refuse instead of writing files nothing uses.
  const mono = project("monorepo", { workspaces: ["apps/*"] }, ["apps/web"]);
  assert.match(fails(mono, "init"), /monorepo root/);
  assert.match(fails(mono, "new", "payslip"), /monorepo root/);
  writeFileSync(join(mono, "apps/web/package.json"), JSON.stringify({ dependencies: { next: "15" } }));
  mkdirSync(join(mono, "apps/web/app"));
  run(join(mono, "apps/web"), "init");
  run(join(mono, "apps/web"), "add", "order-status");
  assert.match(read("monorepo", "apps/web/ui-calling/ui.ts"), /orderStatusImpl,/);
  console.log("generated  monorepo/apps/web (+1 block)");

  // Recipes: every one is listed and prints, and every link in them still points at a real file.
  const recipesDir = join(root, "packages/cli/recipes");
  const recipes = readdirSync(recipesDir).filter((f) => f.endsWith(".md") && f !== "README.md");
  const index = run(tmp, "guide", "recipes");
  for (const f of recipes) {
    const name = f.slice(0, -3);
    assert.ok(index.includes(`(${f})`), `recipes/README.md lists ${name}`);
    const text = run(tmp, "guide", name);
    for (const [, link] of text.matchAll(/\]\(([^)#]+\.(?:md|ts|tsx))\)/g)) {
      // From the CLI, repo files are GitHub links (the repo has no other address for someone with only the package).
      const repoPath = link.replace("https://github.com/pausanchez/ui_calling/blob/main/", "");
      const onDisk = repoPath === link ? join(recipesDir, link) : join(root, repoPath);
      assert.ok(existsSync(onDisk), `${f} links to ${link}, which doesn't exist`);
    }
  }
  assert.match(fails(tmp, "guide", "no-such-recipe"), /No recipe "no-such-recipe"/);
  console.log(`ok         ${recipes.length} recipes listed, printed, and their links resolve`);

  writeFileSync(join(tmp, "tsconfig.json"), JSON.stringify({ extends: "../tsconfig.json", include: ["./**/*.ts", "./**/*.tsx"] }));
  execFileSync("npx", ["tsc", "-p", join(tmp, "tsconfig.json")], { cwd: root, stdio: "inherit" });
  console.log("ok         init and new produce code that typechecks in every layout");
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
