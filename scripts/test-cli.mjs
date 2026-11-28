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
// npm 11 rewrites a bin path that starts with "./" on publish, with a warning that it "was invalid and removed".
const cliPkg = JSON.parse(readFileSync(join(root, "packages/cli/package.json"), "utf8"));
for (const [name, path] of Object.entries(cliPkg.bin)) assert.ok(!path.startsWith("./"), `bin ${name}: write "${path.slice(2)}", not "${path}"`);
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
  // One line per surface, so each `new` is a one-line diff.
  assert.match(runtime, /\n    shiftPickerImpl,\n    linkAccountImpl,\n    \/\* ui-calling:surfaces \*\//);
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

  // Vite: server code goes in server/ (src/ is bundled for the browser), with a Hono entry, the /api proxy and
  // the /s/:token route wired into create-vite's files.
  const vite = project("init-vite", { scripts: { dev: "vite" }, devDependencies: { vite: "7" } }, ["src"], {
    "vite.config.ts": "import { defineConfig } from 'vite'\nimport react from '@vitejs/plugin-react'\n\nexport default defineConfig({\n  plugins: [react()],\n})\n",
    "src/main.tsx": "import { StrictMode } from 'react'\nimport { createRoot } from 'react-dom/client'\nimport App from './App'\n\ncreateRoot(document.getElementById('root')!).render(\n  <StrictMode>\n    <App />\n  </StrictMode>,\n)\n",
    "src/App.tsx": "export default function App() {\n  return <p>app</p>;\n}\n",
    "tsconfig.json": '{\n  "files": [],\n  "references": [\n    { "path": "./tsconfig.app.json" },\n    { "path": "./tsconfig.node.json" }\n  ]\n}\n',
  });
  const viteOut = run(vite, "init");
  assert.match(viteOut, /npm run dev:api/);
  assert.match(read("init-vite", "server/ui.ts"), /http:\/\/localhost:5173/);
  assert.match(read("init-vite", "server/store.ts"), /\.ui-calling\/dev\.db/, "a clean install doesn't wipe the dev database");
  assert.match(read("init-vite", "server/index.ts"), /from "\.\/ui"/);
  assert.ok(!read("init-vite", "src/ui-calling/surface-screen.tsx").includes("use client"), "no Next.js directive outside Next.js");
  assert.match(read("init-vite", "vite.config.ts"), /proxy: \{ "\/api": `http:\/\/localhost:\$\{process\.env\.API_PORT \?\? 8787\}` \}/);
  assert.match(read("init-vite", "src/main.tsx"), /import \{ surfaceRoute \} from "\.\/ui-calling\/surface-route";\n[\s\S]*\{surfaceRoute\(\) \?\? <App \/>\}/);
  assert.match(read("init-vite", "package.json"), /"dev:api": "tsx watch --env-file-if-exists=\.env server\/index\.ts"/);
  // `tsc -b` covers the server too.
  assert.match(read("init-vite", "tsconfig.json"), /\{ "path": "\.\/tsconfig\.server\.json" \}/);
  assert.match(read("init-vite", "tsconfig.server.json"), /"include": \["server"\]/);
  const viteConfig = JSON.parse(read("init-vite", "ui-calling.json"));
  assert.equal(viteConfig.serverDir, "server");
  assert.equal(viteConfig.devUrl, "http://localhost:5173");
  run(vite, "init"); // again: nothing patched twice
  assert.equal(read("init-vite", "src/main.tsx").match(/surfaceRoute/g)?.length, 2);
  assert.equal(read("init-vite", "vite.config.ts").match(/proxy/g)?.length, 1);
  run(vite, "new", "order-tracker");
  assert.match(read("init-vite", "server/order-tracker.server.ts"), /from "\.\.\/src\/ui-calling\/order-tracker\.surface"/);
  assert.match(read("init-vite", "server/ui.ts"), /orderTrackerImpl,/);
  // The steps template keeps its drafts in init's store.
  run(vite, "new", "stock-count", "--template", "steps");
  assert.match(read("init-vite", "server/stock-count.server.ts"), /import \{ drafts \} from "\.\/store";/);
  assert.match(read("init-vite", "server/stock-count.server.ts"), /`stock_count:\$\{subject\}/);
  // link-account for users who type an employee number: registered with it, and again with another replaces it.
  run(vite, "add", "link-account", "--identifier", "text");
  assert.match(read("init-vite", "src/ui-calling/surface-screen.tsx"), /link_account: \(\) => <LinkAccount identifier="text" \/>,/);
  run(vite, "add", "link-account", "--identifier", "tel");
  assert.equal(read("init-vite", "src/ui-calling/surface-screen.tsx").match(/link_account:/g)?.length, 1);
  assert.match(read("init-vite", "server/identity.ts"), /from "\.\/store";/);
  assert.match(fails(vite, "add", "link-account", "--identifier", "fax"), /email, tel, text/);
  console.log("generated  init-vite (+2 surfaces, +1 block)");

  // Postgres: installed, so init writes the Postgres store; the steps template uses its drafts the same way, and a
  // block that needs SQLite is refused with a reason.
  const pgApp = project("init-next-postgres", { dependencies: { next: "16", "@ui-calling/postgres": "0.0.1" } }, ["app"]);
  const pgOut = run(pgApp, "init");
  assert.match(read("init-next-postgres", "ui-calling/store.ts"), /export const store = postgresStore\(pool\)/);
  assert.match(pgOut, /DATABASE_URL/);
  assert.match(pgOut, /npm install [^\n]* pg @types\/pg/);
  assert.doesNotMatch(pgOut, /@ui-calling\/sqlite/);
  assert.equal(JSON.parse(read("init-next-postgres", "ui-calling.json")).store, "postgres");
  run(pgApp, "new", "intake", "--template", "steps");
  assert.match(read("init-next-postgres", "ui-calling/intake.server.ts"), /import \{ drafts \} from "\.\/store";/);
  assert.match(fails(pgApp, "add", "link-account"), /needs the SQLite store/);
  assert.match(fails(pgApp, "init", "--store", "mysql"), /"sqlite" or "postgres"/);
  // Switching back to SQLite rewrites store.ts without --force, and the surface stays registered.
  assert.match(run(pgApp, "init", "--store", "sqlite"), /store switched to sqlite/);
  assert.match(read("init-next-postgres", "ui-calling/store.ts"), /export const store = sqliteStore\(/);
  assert.match(read("init-next-postgres", "ui-calling/ui.ts"), /intakeImpl,/);
  assert.equal(JSON.parse(read("init-next-postgres", "ui-calling.json")).store, "sqlite");
  // Every package installed (to try it out): SQLite, which runs without a database.
  const both = project("init-next-both", { dependencies: { next: "16", "@ui-calling/postgres": "0.0.1", "@ui-calling/sqlite": "0.0.1" } }, ["app"]);
  assert.match(run(both, "init"), /--store postgres for Postgres/);
  assert.equal(JSON.parse(read("init-next-both", "ui-calling.json")).store, "sqlite");
  console.log("generated  init-next-postgres (+1 surface), init-next-both");

  // React Router 7 builds on Vite but has its own server: two routes, no Hono, no proxy.
  const rr = project("init-react-router", { scripts: { dev: "react-router dev --port 5320" }, dependencies: { "react-router": "7" }, devDependencies: { "@react-router/dev": "7", vite: "7" } }, ["app/routes/+types"], {
    "app/routes.ts": 'import { type RouteConfig, index } from "@react-router/dev/routes";\n\nexport default [index("routes/home.tsx")] satisfies RouteConfig;\n',
    "app/app.css": '@import "tailwindcss";\n\nhtml,\nbody {\n  @apply bg-white dark:bg-gray-950;\n}\n',
    // What `react-router typegen` would generate for the two routes, so the typecheck below covers them.
    "app/routes/+types/api.ui.ts": "export namespace Route {\n  export type LoaderArgs = { request: Request };\n  export type ActionArgs = { request: Request };\n}\n",
    "app/routes/+types/s.$token.ts":
      "export namespace Route {\n  type Data = { returnUrl?: string; title?: string };\n  export type HeadersFunction = () => Record<string, string>;\n  export type MetaFunction = (args: { loaderData: Data | undefined }) => unknown[];\n  export type ComponentProps = { params: { token: string }; loaderData: Data };\n}\n",
  });
  const rrOut = run(rr, "init", "--time-zone", "Europe/Madrid");
  assert.match(rrOut, /Setting up ui-calling for React Router/);
  assert.doesNotMatch(rrOut, /dev:api/);
  assert.ok(!existsSync(join(rr, "server/index.ts")), "no Hono server: React Router has its own");
  assert.match(read("init-react-router", "app/routes.ts"), /import \{ type RouteConfig, index, route \}[\s\S]*route\("api\/ui\/\*", "routes\/api\.ui\.ts"\),\n  route\("s\/:token", "routes\/s\.\$token\.tsx"\),\n  index\("routes\/home\.tsx"\)\] satisfies/);
  assert.match(read("init-react-router", "app/routes/api.ui.ts"), /from "\.\.\/\.\.\/server\/ui"/);
  assert.match(read("init-react-router", "app/routes/s.$token.tsx"), /from "\.\.\/ui-calling\/surface-screen"/);
  assert.match(read("init-react-router", "server/ui.ts"), /http:\/\/localhost:5320/, "the port from the dev script");
  assert.match(read("init-react-router", "server/ui.ts"), /timeZone: "Europe\/Madrid"/);
  assert.match(read("init-react-router", "server/ui.ts"), /process\.loadEnvFile\(\)/);
  assert.match(read("init-react-router", "app/app.css"), /@import "\.\/ui-calling\/tokens\.css";/);
  assert.match(rrOut, /bg-background text-foreground/, "the starter's html/body background is pointed out");
  run(rr, "init", "--force"); // again: routes.ts isn't patched twice
  assert.equal(read("init-react-router", "app/routes.ts").match(/api\/ui/g)?.length, 1);
  run(rr, "new", "todays-route");
  assert.match(read("init-react-router", "server/ui.ts"), /todaysRouteImpl,/);
  // init --force after new: the files are rewritten, and the surface is registered again.
  run(rr, "init", "--force");
  assert.match(read("init-react-router", "server/ui.ts"), /import \{ todaysRouteImpl \} from "[^"]+";[\s\S]*todaysRouteImpl,\n\s*\/\* ui-calling:surfaces \*\//);
  assert.equal(read("init-react-router", "server/ui.ts").match(/todaysRouteImpl,/g)?.length, 1);
  assert.match(read("init-react-router", "app/ui-calling/surface-screen.tsx"), /todays_route: \(\) => <TodaysRoute \/>,/);
  // `<command> --help` prints that command only.
  const help = run(rr, "init", "--help");
  assert.match(help, /--framework next\|vite\|react-router\|other/);
  assert.doesNotMatch(help, /whatsapp dev/);
  rmSync(join(rr, "app/routes.ts")); // the fixture's own file: it imports @react-router/dev, which the repo doesn't install
  console.log("generated  init-react-router (+1 surface)");

  // A plain Express app: the Node handler, the screens' page, and a .gitignore when there's none.
  const ex = project("init-express", { scripts: { dev: "tsx watch server.ts" }, dependencies: { express: "5" } });
  const exOut = run(ex, "init", "--time-zone", "Europe/Madrid");
  assert.match(exOut, /Setting up ui-calling for Express/);
  assert.match(exOut, /uiCallingNodeHandler\(ui, \{ dev:/);
  assert.match(exOut, /before any body parser/);
  assert.match(exOut, /react react-dom vite @vitejs\/plugin-react tailwindcss @tailwindcss\/vite/, "the screens' page needs React and a bundler");
  assert.match(read("init-express", ".gitignore"), /^\.ui-calling\/$/m, "created when missing: Tailwind v4 scans what git doesn't ignore");
  // Express on "module": "nodenext": every relative import the CLI writes ends in .js (the final typecheck resolves them).
  const nn = project("init-express-nodenext", { type: "module", dependencies: { express: "5" } }, [], {
    "tsconfig.json": JSON.stringify({ compilerOptions: { module: "nodenext", moduleResolution: "nodenext" } }),
  });
  run(nn, "init");
  run(nn, "new", "shift-picker");
  run(nn, "new", "intake", "--template", "steps");
  assert.match(read("init-express-nodenext", "server/ui.ts"), /from "\.\/store\.js";/);
  assert.match(read("init-express-nodenext", "server/ui.ts"), /from "\.\/shift-picker\.server\.js";/);
  assert.match(read("init-express-nodenext", "ui-calling/shift-picker.tsx"), /from "\.\/shift-picker\.surface\.js";/);
  assert.match(read("init-express-nodenext", "ui-calling/surface-screen.tsx"), /from "\.\/shift-picker\.js";/);
  const bare = project("init-bare", {});
  assert.match(run(bare, "init"), /using the generic setup/);
  console.log("generated  init-express, init-express-nodenext, init-bare");

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
      const repoPath = link.replace("https://github.com/pausanchez/ui-calling/blob/main/", "");
      const onDisk = repoPath === link ? join(recipesDir, link) : join(root, repoPath);
      assert.ok(existsSync(onDisk), `${f} links to ${link}, which doesn't exist`);
    }
  }
  assert.match(fails(tmp, "guide", "no-such-recipe"), /No section or recipe "no-such-recipe"/);
  // Sections by heading, or by one word of it.
  assert.match(run(tmp, "guide", "toc"), /testing-without-servers/);
  assert.match(run(tmp, "guide", "testing"), /^## Testing without servers/);
  console.log(`ok         ${recipes.length} recipes listed, printed, and their links resolve`);

  writeFileSync(join(tmp, "tsconfig.json"), JSON.stringify({ extends: "../tsconfig.json", include: ["./**/*.ts", "./**/*.tsx"] }));
  execFileSync("npx", ["tsc", "-p", join(tmp, "tsconfig.json")], { cwd: root, stdio: "inherit" });
  console.log("ok         init and new produce code that typechecks in every layout");
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
