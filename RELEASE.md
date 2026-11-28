# Releasing ui-calling

Everything is prepared; nothing is published. Going public happens in the order below, and each step that publishes something is done by a person, on purpose.

## 0. The gates

There are two releases, each with its own gate (decided 2026-11-28, replacing the 2026-11-24 rule that nothing goes public before a real product with real users: the first client comes after the first release).

**Preview, on npm (`0.1.0-preview.N`).** No client needed. It goes out when sections 1 and 2 are done. A prerelease version tells developers the API may still change, and without npm no developer tries it: four pilot apps and two fresh coding agents (PR #14) have already built on it from the tarballs.

**Stable (`0.1.0`, the "preview" label removed).** Real users first:
- [ ] The event pilot below has run, and its findings are fixed or listed under "Known limits".
- [ ] The coding-agent test passes against the packages on npm (section 5).
- [ ] At least one product we don't own runs it with real users.

### The event pilot

Real people, without a client: the [event concierge](https://github.com/pausanchez/ui-calling-event-concierge) (already on Vercel, Supabase Postgres and a WhatsApp number) runs one real event we organize, 20 to 50 guests, for about a week.

- **Before:** the guests agree to it in the invitation, and a privacy note says what is stored and for how long. An approved WhatsApp template covers follow-ups after 24 hours; Meta's approval can take days, so ask early. `ui.sweep()` runs from a cron, and `ui.forget({ expiredBefore })` runs once the event is over.
- **Measure, from the events and `onTrace`, never from payloads:** links opened, finished and abandoned; how many abandons the agent's follow-up brings back; failures by `kind`; time to finish; any agent reply that says something the screen didn't record.
- **After:** a short write-up of what failed and what was confusing; each finding becomes a fix or a known limit.

## 1. Decisions

- [x] **Version.** The preview is `0.1.0-preview.0` for all packages, released together; later previews bump the last number, and the stable release is `0.1.0`.
- [x] **Copyright holder** in `LICENSE` (MIT; copied into every package): "San Pau" (decided 2026-11-28), in the root `LICENSE` and `packages/*/LICENSE`.
- [x] **npm organization.** The npm org `ui-calling` exists, owned by `sanpau` (2026-11-28). The names `ui-calling` and `@ui-calling/*` were free on 2026-11-25; check again with `npm view <name>` right before publishing.
- [x] **Public repo.** The docs site on GitHub Pages is public either way. From a private repo, Pages needs a paid plan; otherwise make the repo public first.

## 2. Before publishing

- [x] The pilots' findings are fixed: the Next.js + Anthropic SDK pilot (PRs #22, #23), the Vite + AI SDK pilot (PR #24), the React Router + Anthropic manual loop pilot (PR #26) and the Express + OpenAI Responses pilot (PR #29).
- [x] The security review's findings are fixed or listed under "Known limits" below (see the PR that added this file).
- [x] `npm test` passes.
- [x] Change the pre-release notes from "not on npm yet" to "preview on npm":
  - `README.md`: the "Preview" note at the top keeps "the API may still change" and drops "Not on npm yet"; the install line under "Get started" points at `npm install`.
  - `docs/getting-started.md`: the "Not on npm yet" note and the tarball install under "Install and set up" become `npm install @ui-calling/core @ui-calling/server @ui-calling/react @ui-calling/sqlite ui-calling zod`, with the adapters and `@ui-calling/postgres` named the same way. The tarball steps for trying a change live in AGENTS.md.
  - `packages/cli/GUIDE.md`: the "Not on npm yet" note at the top.
  - The `v0.0.1-preview` GitHub release: mark it superseded by the npm preview.
  - The docs page artifact, if it's still shared: its "Pre-release" note.
- [x] Set the version in every `packages/*/package.json`, and the `@ui-calling/core` range in `server`, `react`, `sqlite`, `postgres` and the adapters (`^0.1.0-preview.0`, which also accepts later previews and `0.1.0`).
- [x] `npm run build`.
- [x] Try the packed tarballs in fresh apps, as in AGENTS.md: `create-next-app`, install the tarballs, `init`, `new` (both templates), `next build`, then `npx ui-calling link` against `next dev`; the same on create-vite (`tsc -b`, `vite build`, a screen with `dev` and `dev:api` running), on create-react-router (`npm run typecheck`, `react-router build`), and on a plain Express app (`init`, `uiCallingNodeHandler`, `link`, `events`).

## Known limits (from the security review, accepted for the preview and 0.1)

- No automatic retention: expired sessions, events and uploaded files stay in the database until you run `ui.forget({ expiredBefore })` (on a schedule) or `ui.forget({ subject })` (a deletion request).
- Uploaded files are typed by what the browser says, not by their bytes. They're served safely (sandboxed, `nosniff`, non-images download), but check magic bytes before forwarding them elsewhere.
- The token is in the URL path, so it can reach access logs (documented in the README's security model).

## 3. Publish

Order matters: core first, the CLI last.

```bash
npm run build
npm publish -w packages/core --tag next
npm publish -w packages/sqlite -w packages/postgres -w packages/server -w packages/react --tag next
npm publish -w packages/anthropic -w packages/ai-sdk -w packages/openai -w packages/mcp --tag next
npm publish -w packages/cli --tag next
```

- **`--tag next`:** npm 11 refuses to publish a prerelease (`0.1.0-preview.N`) without a tag. The first version of a package also becomes its `latest`, so `npm install @ui-calling/core` installs it; the stable release publishes without `--tag`.
- **2FA:** npm needs two-factor authentication on the account to publish, and asks for it in the browser on each `npm publish`.
- **Review:** a package's first publish can sit in npm's review for a while, showing only a placeholder (`0.0.0-stage`, "awaiting a staged release"). `npm view <name>` shows the real version once it's through.
- **A version can't be published twice.** If one goes out wrong, fix it and bump that package (`0.1.0-preview.1`).
- **`bin` paths without `./`:** npm 11 rewrites `./bin/ui-calling.mjs` on publish with a warning that reads as if the command were removed (it isn't). `test-cli` checks the plain form, so the warning doesn't come back.

Scoped packages publish as public (`publishConfig.access`).

Then tag it: `git tag v0.1.0-preview.0 && git push origin v0.1.0-preview.0`, and write a GitHub release marked as a pre-release.

## 4. Docs site

Run it again after publishing, so the site shows the npm install.

1. Settings → Pages → Source: **GitHub Actions** (already set; the site is live).
2. Actions → **Docs** → Run workflow. It runs `npm run docs` and deploys `docs-site/`. It never runs on its own.
3. The site is `https://pausanchez.github.io/ui-calling/`. Link it from the README and each package's `homepage`.

`npm run docs` builds the same site locally (open `docs-site/index.html`). It's made from README.md, GUIDE.md and the recipes, so it always matches what `npx ui-calling guide` prints.

## 5. After

- [ ] In a new folder, install from npm, not tarballs: `npm install @ui-calling/core @ui-calling/server @ui-calling/react @ui-calling/sqlite zod`, then `npx ui-calling init`, `new`, `link`.
- [ ] Run the coding-agent test again against the published packages (same brief as PR #14).
