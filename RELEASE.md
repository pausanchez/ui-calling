# Releasing UI_calling

Everything is prepared; nothing is published. Going public happens in the order below, and each step that publishes something is done by a person, on purpose.

## 0. The gate

UI_calling goes public only after it runs in a real project (decided 2026-11-24). Two fresh coding agents have built a full return flow from the package alone (see PR #14), but a real product with real users comes first.

## 1. Decisions

- [ ] **Version.** Every package is `0.0.1` today. Suggested first release: `0.1.0` for all packages, released together.
- [ ] **Copyright holder** in `LICENSE` (MIT; copied into every package): currently "pausanchez". Change it to a full name or a company if you prefer, in the root `LICENSE` and `packages/*/LICENSE`.
- [ ] **npm organization.** The `@ui-calling` scope needs an npm org named `ui-calling` (free for public packages). The names `ui-calling` and `@ui-calling/*` were free on 2026-11-25; check again with `npm view <name>` right before publishing.
- [ ] **Public repo.** The docs site on GitHub Pages is public either way. From a private repo, Pages needs a paid plan; otherwise make the repo public first.

## 2. Before publishing

- [x] The pilots' findings are fixed: the Next.js + Anthropic SDK pilot (PRs #22, #23), the Vite + AI SDK pilot (PR #24), the React Router + Anthropic manual loop pilot (PR #26) and the Express + OpenAI Responses pilot (PR #29).
- [x] The security review's findings are fixed or listed under "Known limits" below (see the PR that added this file).
- [ ] `npm test` passes.
- [ ] Remove the pre-release notes:
  - `README.md`: the "Not on npm yet" note under "Add it to your project", and the tarball steps under "Building and publishing" (keep them as "trying a change before release").
  - `packages/cli/GUIDE.md`: the "Not on npm yet" note at the top.
  - The docs page artifact, if it's still shared: its "Pre-release" badge and note.
- [ ] Set the version in every `packages/*/package.json`, and the `@ui-calling/core` range in `server`, `react`, `sqlite` and the adapters (`^0.1.0`).
- [ ] `npm run build`.
- [ ] Try the packed tarballs in fresh apps, as in AGENTS.md: `create-next-app`, install the tarballs, `init`, `new` (both templates), `next build`, then `npx ui-calling link` against `next dev`; the same on create-vite (`tsc -b`, `vite build`, a screen with `dev` and `dev:api` running), on create-react-router (`npm run typecheck`, `react-router build`), and on a plain Express app (`init`, `uiCallingNodeHandler`, `link`, `events`).

## Known limits (from the security review, accepted for 0.1)

- No automatic retention: expired sessions, events and uploaded files stay in the database until you run `ui.forget({ expiredBefore })` (on a schedule) or `ui.forget({ subject })` (a deletion request).
- Uploaded files are typed by what the browser says, not by their bytes. They're served safely (sandboxed, `nosniff`, non-images download), but check magic bytes before forwarding them elsewhere.
- The token is in the URL path, so it can reach access logs (documented in the README's security model).

## 3. Publish

Order matters: core first, the CLI last.

```bash
npm publish -w packages/core
npm publish -w packages/sqlite -w packages/server -w packages/react
npm publish -w packages/anthropic -w packages/ai-sdk -w packages/openai -w packages/mcp
npm publish -w packages/cli
```

Scoped packages publish as public (`publishConfig.access`). npm asks for your two-factor code.

Then tag it: `git tag v0.1.0 && git push origin v0.1.0`, and write a GitHub release.

## 4. Docs site

1. Settings → Pages → Source: **GitHub Actions**.
2. Actions → **Docs** → Run workflow. It runs `npm run docs` and deploys `docs-site/`. It never runs on its own.
3. The site is `https://pausanchez.github.io/ui_calling/`. Link it from the README and each package's `homepage`.

`npm run docs` builds the same site locally (open `docs-site/index.html`). It's made from README.md, GUIDE.md and the recipes, so it always matches what `npx ui-calling guide` prints.

## 5. After

- [ ] In a new folder, install from npm, not tarballs: `npm install @ui-calling/core @ui-calling/server @ui-calling/react @ui-calling/sqlite zod`, then `npx ui-calling init`, `new`, `link`.
- [ ] Run the coding-agent test again against the published packages (same brief as PR #14).
