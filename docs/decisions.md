# Decisions

Things decided beyond the spec, with the reasoning that produced them. Append; do not rewrite history. A decision that is later reversed gets a new entry saying so, not an edit.

Each entry records what was chosen, what it cost, and what would make it wrong — the last one matters most, because it is what tells a future reader whether the decision still holds.

---

## M1-01 · Project scaffold

### 1. TypeScript pinned to `^6`, not 7

TypeScript 7 is available and is the obvious reach. It cannot be used yet.

`typescript-eslint` 8.66 hard-throws on TS 7.0 with _"does not support TS 7.0"_, and because `eslint-config-next` sits on top of typescript-eslint, the failure takes the entire lint run with it — not one rule, the whole config.

Lint is not cosmetic here. It is where the `src/domain/` purity boundary is enforced (CLAUDE.md rule 6), and that boundary is what keeps the payment provider swappable while the Mode B regulatory position is unresolved (architecture §0.2). Trading it for a compiler version is not a sensible exchange.

**Reversible when:** typescript-eslint ships TS 7 support and `eslint-config-next` picks it up. Try the bump then; nothing else depends on the pin.

### 2. ESLint pinned to `^9`, not 10

Same shape of problem, different package. `eslint-plugin-react` 7.37.5 — a transitive dependency of `eslint-config-next` 16 — calls `context.getFilename`, which ESLint 10 removed. The config fails to load.

**Reversible when:** `eslint-plugin-react` drops the removed API and `eslint-config-next` ships the newer version.

### 3. TypeScript strictness beyond `strict`

Enabled: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `noImplicitOverride`, `noFallthroughCasesInSwitch`.

Most of these are ordinary discipline. **`exactOptionalPropertyTypes` is load-bearing and should not be removed to make a type error go away.**

It is what makes `{ animate: undefined }` a distinct type from `{}`, and what makes `accent?: string` meaningfully different when present-but-undefined versus absent. Both distinctions are exactly the ones CLAUDE.md rules 1 and 2 rest on:

- Rule 1 requires `animate` to be **explicitly `false`**, never merely absent. Without this flag the type system cannot tell those apart, and the bereavement guard degrades from a compile error to a convention.
- Rule 2 requires bereavement to declare **no** accent, so `var(--accent, #16233D)` falls back to indigo. "Absent" has to be a real state in the type system for that to be checkable.

Turning it off would not break the build. It would quietly demote two of the three enforcement layers on the funeral case, which is the failure CLAUDE.md says is not recoverable.

### 4. Domain boundary enforced with core `no-restricted-imports`

Considered and rejected: `eslint-plugin-boundaries`, `eslint-plugin-import` with a resolver. Both are a dependency, a supply-chain surface and a bundle of behaviour, for something the core rule already does.

Patterns are gitignore-style and cover each forbidden layer twice — `@/db/**` for the aliased form and `**/db/**` for the bare and relative forms. The relative escape is the one that actually happens: an editor auto-import writes `../../adapters/payments` and it reads as innocuous in review.

**`node:crypto` is deliberately allowed.** The ledger hash chain (architecture §4.3) is domain logic, not I/O, and it needs SHA-256. The other Node built-ins that constitute real I/O — `fs`, `http`, `net`, `dns`, `child_process` and friends — are blocked in both bare and `node:` forms.

### 5. `NEXT_PUBLIC_APP_URL` requires an http(s) scheme and no trailing slash

`URL.canParse` alone is too permissive to be worth anything here. It accepts `localhost:3000`, reading `localhost:` as a scheme, and it accepts `postgres://user:pw@db:5432/isipheko`.

The second is the realistic misconfiguration: the wrong variable pasted into the right slot in a deployment console. It would validate, the app would start, and every WhatsApp share link and OG image URL would be built from a database DSN. The failure would surface as contributors unable to open a link — the worst possible place to discover it.

The trailing-slash check exists because this value is concatenated to build share URLs, and `https://isipheko.co.za//e/abc` is an avoidable embarrassment on the one link the family sends to everyone they know.

### 6. Env validated in development with documented defaults; production has none

A clean clone runs with `pnpm install && pnpm dev` and no `.env` file. Defaults live in the schema and are mirrored in `.env.example`, so the documented value and the actual value cannot drift.

In production there are no defaults and every variable is required. The asymmetry is intentional: a forgotten variable in development costs a few seconds, and in production it is a live misconfiguration on a page asking strangers for money.

Errors accumulate — every problem is reported at once, rather than one per restart — and never print a value, only the variable name (CLAUDE.md rule 8).

### 7. The boot guard exits the process; it does not merely throw

Discovered by testing rather than by reading, and it is the substance of the task.

`src/instrumentation.ts` originally let the `EnvironmentError` propagate out of `register()`. Verified against Next 16.3.0: **that does not stop the server.** Next catches the throw, logs an `unhandledRejection`, prints `✓ Ready`, binds the port, and then answers every request with a 500. Measured directly: `GET /` returned HTTP 500 while the process stayed alive indefinitely.

That is worse than no guard at all. A container in that state passes a TCP health check, stays in the load balancer, and serves 500s to contributors — precisely the "fails later at runtime" outcome the guard exists to prevent.

`register()` now catches, reports, and calls `process.exit(1)`. Re-verified in isolation, with the `next.config.ts` import disabled so the instrumentation path was the only guard: the process exits 1, serves nothing, and logs no `unhandledRejection`.

The `StartupHost` seam exists only so tests can assert the refusal without a real `process.exit` taking the test runner down. In the edge runtime, where `process.exit` is absent, it rethrows — worse than exiting, better than swallowing.

The build path was tested the same way and was already correct: `pnpm build` exits 1 and produces no artefact for a missing value and for each malformed form.

### 8. `pnpm test` is Vitest only; Playwright lives behind `pnpm test:e2e`

`pnpm typecheck && pnpm lint && pnpm test` runs after every task. It has to stay fast enough that nobody is tempted to skip it. Vitest alone is seconds; Playwright needs a browser download and a dev server.

CI runs both. The developer loop runs one.

### 9. Playwright targets `localhost`, not `127.0.0.1`

`next dev` serves its own chunks and HMR endpoint from `localhost` and blocks them as cross-origin when the page is loaded over the IP.

The trap is that nothing fails. The root page is a server component, so it renders and the smoke test passes — while no client JavaScript has loaded at all. The suite is green and is testing less than it appears to. That would have hollowed out the visual and axe projects arriving in M1-05, which depend on the page being genuinely interactive.

Fixed in `playwright.config.ts` rather than by adding `allowedDevOrigins` to `next.config.ts`: this is a test-harness concern and does not belong in application config.

### 10. `.npmrc` lowers network concurrency rather than raising it

`network-concurrency=4` with `fetch-retries=8` and a retry timeout up to 180s.

The default of 16 parallel fetches is tuned for a fat link. On a lossy one it is actively harmful — parallel streams compete for a congested path and multiply the retransmissions. Lower concurrency with patient retries completes; higher concurrency stalls.

Not a CI concern. This is a South African product, and some of the people building it are on the same connections the contributors are.

### 11. `agentRules: false` — Next may not write to `CLAUDE.md`

`next dev` appends a delimited `<!-- BEGIN:nextjs-agent-rules -->` block to `CLAUDE.md` on every run, from `node_modules/next/dist/server/lib/generate-agent-files.js`. Nobody asked it to.

Disabled with `agentRules: false` in `next.config.ts`.

The content was not the problem — it was accurate, and Next 16 genuinely does differ from what a model is likely to have been trained on. The problem is what it did to the file. `CLAUDE.md` is the behavioural contract for this project, read at the start of every session and cited by rule number in code comments. If a framework rewrites it as a side effect of starting the dev server, its diffs stop meaning anything, and a change nobody made becomes indistinguishable from a change somebody did. A tool that edits the contract on its own schedule is a tool that can quietly edit the rules.

The one useful thing the block said is now a line we chose to write, in the Reference section of `CLAUDE.md`: read `node_modules/next/dist/docs/` before writing route, config or rendering code.

### 12. `design/` reduced to one export per screen

The directory held three overlapping exports of each screen: a working copy, an `Isipheko *.dc.html` duplicate, and an `Isipheko *.html` preview bundle of 200–270KB carrying a preview runtime. 2.0MB total for seven screens.

Deleted the duplicates and the bundles after diffing every pair — the `.dc.html` files were byte-identical to the kept files apart from a `__bundler_thumbnail` template the kept files also have, so nothing was lost. 2.0MB → 332K.

Two files needed judgement rather than deletion. `Isipheko Page.dc.html` and `IsiphekoPage.dc.html` had no renamed counterpart and were not duplicates of anything. Diffing them against each other showed the first is the newer: it carries the group-bead implementation — one bead per collection, members revealed on open, with the comment _"eight beads would read as eight small gifts instead of one act by one group"_ — which is CLAUDE.md rule 14 rendered. The older file predates collections entirely.

Kept the newer as `design/event.html`; deleted the superseded one. `support.js` is referenced by every remaining screen and stays.

`funeral.html` was then deleted too. It and `event.html` were the same page: identical funeral copy, with `event.html` additionally carrying collections and the archetype switch — a strict superset. Two files showing one screen is an invitation to drift, and when they disagree in three months there is no way to tell which was intended. One screen, one file.

`design/` went from 2.0MB across twenty-one files to 300K across seven. The references in `docs/implementation-plan.md` — the Part B tree and M1-08 — now point at `design/event.html`.

### 13. Prettier ignores the authored prose documents

`pnpm format:check` was failing on thirteen files, ten of which predate this task. The code and config files were formatted; the prose was not.

`CLAUDE.md`, `docs/architecture.md`, `docs/implementation-plan.md` and the two phase-1 documents are now in `.prettierignore`, for the same reason `design/` already was. Reformatting them reflows tables and normalises list markers across documents nobody asked to have rewritten, producing a large diff that communicates nothing — on precisely the files most often read by a human rather than a tool.

`CLAUDE.md` has a second reason: it cannot be kept Prettier-stable, because `next dev` appends its agent-rules block on every run (see 11).

`docs/decisions.md` is not ignored. It is written in this loop and may as well stay formatted.
