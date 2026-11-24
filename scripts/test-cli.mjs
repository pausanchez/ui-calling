// Generates surfaces with `ui-calling new` in several folder layouts and typechecks the result.
// Layouts deliberately use different depths: an import path that's only right by accident fails here.
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const tmp = join(root, ".tmp-cli-test");
const cli = join(root, "packages/cli/bin/ui-calling.mjs");

const layouts = [
  ["same-dir", ["--dir", "components"]],
  ["server-shallower", ["--dir", "src/components/ui-calling", "--server-dir", "server"]],
  ["server-deeper", ["--dir", "ui", "--server-dir", "server/api/surfaces"]],
];

rmSync(tmp, { recursive: true, force: true });
try {
  for (const [name, args] of layouts) {
    const dir = join(tmp, name);
    mkdirSync(dir, { recursive: true });
    execFileSync("node", [cli, "new", "shift-picker", ...args], { cwd: dir, stdio: "pipe" });
    console.log(`generated  ${name}`);
  }
  writeFileSync(join(tmp, "tsconfig.json"), JSON.stringify({ extends: "../tsconfig.json", include: ["./**/*.ts", "./**/*.tsx"] }));
  execFileSync("npx", ["tsc", "-p", join(tmp, "tsconfig.json")], { cwd: root, stdio: "inherit" });
  console.log("ok         generated code typechecks in every layout");
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
