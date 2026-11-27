// Builds the docs site from the same Markdown the CLI prints (README, GUIDE, recipes), so the two never drift.
// Output: docs-site/ (gitignored), ready for GitHub Pages. Run: npm run docs   (then open docs-site/index.html)
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, posix, resolve } from "node:path";
import { marked } from "marked";

const root = resolve(import.meta.dirname, "..");
const out = join(root, "docs-site");
const REPO = "https://github.com/pausanchez/ui_calling/blob/main/";
const recipesDir = join(root, "packages/cli/recipes");

// Every page: its source in the repo, where it's served, and its name in the nav.
const recipes = readdirSync(recipesDir).filter((f) => f.endsWith(".md") && f !== "README.md").sort();
const pages = [
  { src: "README.md", href: "index.html", nav: "Overview" },
  { src: "docs/getting-started.md", href: "getting-started.html", nav: "Getting started" },
  { src: "packages/cli/GUIDE.md", href: "guide.html", nav: "Guide" },
  { src: "packages/cli/recipes/README.md", href: "recipes/index.html", nav: "Recipes" },
  ...recipes.map((f) => ({ src: `packages/cli/recipes/${f}`, href: `recipes/${f.replace(/\.md$/, ".html")}` })),
];
const bySrc = new Map(pages.map((p) => [p.src, p]));

const slug = (text) => text.toLowerCase().replace(/<[^>]+>/g, "").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-");
const escape = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A link in the Markdown, as the site should have it: another page, or the file on GitHub. */
function rewrite(href, page) {
  if (/^(https?:|mailto:|#)/.test(href)) return href;
  const [path, hash] = href.split("#");
  const target = posix.normalize(posix.join(posix.dirname(page.src), path));
  const linked = bySrc.get(target);
  const fromHere = (to) => posix.relative(posix.dirname(page.href), to) || posix.basename(to);
  if (linked) return fromHere(linked.href) + (hash ? `#${hash}` : "");
  return REPO + target + (hash ? `#${hash}` : "");
}

function render(page) {
  const md = readFileSync(join(root, page.src), "utf8");
  const toc = [];
  let title = "";
  const renderer = new marked.Renderer();
  renderer.heading = function ({ tokens, depth }) {
    const html = this.parser.parseInline(tokens);
    const id = slug(html);
    if (depth === 1) title ||= html.replace(/<[^>]+>/g, "");
    if (depth === 2 || depth === 3) toc.push({ depth, id, html });
    return `<h${depth} id="${id}"><a class="anchor" href="#${id}" aria-hidden="true">#</a>${html}</h${depth}>\n`;
  };
  renderer.link = function ({ href, title: t, tokens }) {
    const text = this.parser.parseInline(tokens);
    const to = rewrite(href, page);
    const external = /^https?:/.test(to);
    return `<a href="${escape(to)}"${t ? ` title="${escape(t)}"` : ""}${external ? ' target="_blank" rel="noopener"' : ""}>${text}</a>`;
  };
  renderer.code = ({ text, lang }) => {
    const language = { ts: "typescript", tsx: "tsx", bash: "bash", text: "none", json: "json", css: "css" }[lang ?? ""] ?? lang ?? "none";
    return `<div class="code"><button class="copy" type="button">Copy</button><pre><code class="language-${language}">${escape(text)}</code></pre></div>\n`;
  };
  renderer.table = function (token) {
    const head = token.header.map((c) => `<th>${this.parser.parseInline(c.tokens)}</th>`).join("");
    const rows = token.rows.map((r) => `<tr>${r.map((c) => `<td>${this.parser.parseInline(c.tokens)}</td>`).join("")}</tr>`).join("");
    return `<div class="table"><table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>\n`;
  };
  const body = marked.parse(md, { renderer, gfm: true });
  return { title: title || page.nav, body, toc };
}

function layout(page, { title, body, toc }) {
  const rel = (to) => posix.relative(posix.dirname(page.href), to) || posix.basename(to);
  const nav = pages
    .filter((p) => p.nav)
    .map((p) => {
      const current = p.href === page.href || (p.href === "recipes/index.html" && page.href.startsWith("recipes/"));
      return `<a href="${rel(p.href)}"${current ? ' aria-current="page"' : ""}>${p.nav}</a>`;
    })
    .join("");
  const recipeLinks = page.href.startsWith("recipes/")
    ? `<h4>Recipes</h4><ul>${pages
        .filter((p) => p.href.startsWith("recipes/") && !p.nav)
        .map((p) => `<li><a href="${rel(p.href)}"${p.href === page.href ? ' aria-current="page"' : ""}>${p.href.slice(8, -5)}</a></li>`)
        .join("")}</ul>`
    : "";
  const contents = toc.length
    ? `<h4>On this page</h4><ul>${toc.map((h) => `<li class="d${h.depth}"><a href="#${h.id}">${h.html}</a></li>`).join("")}</ul>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title === "ui-calling" ? title : `${escape(title)} · ui-calling`}</title>
<link rel="stylesheet" href="${rel("style.css")}">
</head>
<body>
<header class="top"><div class="bar"><a class="brand" href="${rel("index.html")}">ui-calling</a><nav aria-label="Site">${nav}</nav></div></header>
<div class="shell">
  <aside class="side">${recipeLinks}${contents}</aside>
  <main>${body}<p class="source">Source: <a href="${REPO + page.src}" target="_blank" rel="noopener">${page.src}</a></p></main>
</div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/prism.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/components/prism-typescript.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/components/prism-jsx.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/components/prism-tsx.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/prism/1.29.0/components/prism-bash.min.js"></script>
<script>
for (const b of document.querySelectorAll(".copy")) {
  b.addEventListener("click", async () => {
    const text = b.nextElementSibling.innerText;
    try { await navigator.clipboard.writeText(text); b.textContent = "Copied"; } catch { b.textContent = "Select and copy"; }
    setTimeout(() => (b.textContent = "Copy"), 1500);
  });
}
</script>
</body>
</html>
`;
}

rmSync(out, { recursive: true, force: true });
for (const page of pages) {
  const file = join(out, page.href);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, layout(page, render(page)));
}
writeFileSync(join(out, "style.css"), readFileSync(join(root, "scripts/docs-style.css")));
// Images the README shows (docs/*.png), at the same relative path.
mkdirSync(join(out, "docs"), { recursive: true });
for (const f of readdirSync(join(root, "docs")).filter((f) => !f.endsWith(".md"))) writeFileSync(join(out, "docs", f), readFileSync(join(root, "docs", f)));
// GitHub Pages runs Jekyll unless told not to; it would skip nothing here, but it's slower and surprising.
writeFileSync(join(out, ".nojekyll"), "");
console.log(`docs-site/: ${pages.length} pages`);
