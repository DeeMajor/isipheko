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

---

## M1-02 · Database and schema

### 1. Two database roles, and the ledger guarantee depends on it

`isipheko_owner` owns the schema and runs migrations. `isipheko_app` is what the application connects as.

CLAUDE.md rule 3 says the application database role _lacks the grants_ to update or delete a ledger row. That is only true if there is a second role. Revoking a privilege from the role that owns the table is theatre — an owner keeps implicit rights over its own tables — so a single-role setup would leave the ledger append-only by convention, with every test still passing and nothing actually stopping a rewrite.

Two roles means two connection strings: `DATABASE_URL` for the runtime, `MIGRATION_DATABASE_URL` for `prisma.config.ts`. They are separate variables reached by separate code paths, so collapsing them takes a deliberate edit rather than a stray copy-paste.

**What would make this wrong:** pointing `DATABASE_URL` at the owner to unblock something locally. It would work, the suite would stay green, and the guarantee would be gone. The README says so in as many words.

### 2. Default privileges grant SELECT and INSERT, not everything

`ALTER DEFAULT PRIVILEGES` is set so a table created by a future migration arrives with `SELECT` and `INSERT` only. `UPDATE` and `DELETE` are granted per table, by name, in a list a reviewer can read.

The obvious alternative — grant everything by default, then revoke from `ledger_entries` — inverts the failure mode. It leaves the guarantee depending on somebody remembering to revoke again every time a table is added, and the day they forget there is no error, no failing test and no diff that looks wrong. Here a new table is append-only until a migration says otherwise, and the thing you have to remember to write down is the _permissive_ case.

An integration test creates a table and asserts the privileges it receives, so this cannot rot silently.

### 3. `archetype_group` is denormalised, and cannot drift

A CHECK constraint cannot perform a lookup, and rule 1 requires the bereavement guard to exist in the database. So `events` carries both `archetype` (the specific ceremony) and `archetype_group` (the six-way grouping), and the bereavement CHECK is written against the group.

A denormalised column that is allowed to disagree with its source is worse than no column: an event could carry the wedding group while being a funeral, and be handed a progress bar. A second CHECK therefore maps every key to its group in SQL, so the pair cannot disagree in either direction, on insert or on update. Tests cover both directions and every key — a new archetype added later without a mapping fails there rather than defaulting to something.

The same mapping exists in the archetype config (M1-04). These are the same fact in two places, which is a real cost; the alternative was rule 1 not being enforceable in the database at all.

### 4. No `role` column on organisers

Part D2.8 says adding a role is not sufficient, and it is right for a reason worth writing down: a person is a host on one umcimbi and a collection organiser on another. Storing the role on the person would be wrong the first time somebody does both, which is the ordinary case rather than the edge case.

So the relationship carries the role. `events.organiser_id` makes you a host on that event; `collections.organiser_id` makes you a collection organiser on that collection. One `organisers` table, no role stored anywhere.

Contributors have no table at all. They never authenticate (rule 4), so there is nothing to store.

### 5. Column encryption with the key in the environment — a stopgap, recorded as one

Bank account numbers are AES-256-GCM (`node:crypto`), keyed from `BANK_ACCOUNT_ENCRYPTION_KEY`. ID numbers are SHA-256 with `ID_NUMBER_PEPPER`. Both are 32 bytes of base64, validated after decoding rather than as a string, because base64 tolerates a truncated input and would otherwise yield a short key that still encrypts.

**Architecture §10 and §7.3 put both in a KMS, held separately from the database credential. They belong there before anything real is stored.** They are environment variables today only because the KMS decision has not been taken.

Two things make that survivable rather than a hole:

- Everything goes through the `ColumnCipher` interface, declared in `src/domain/` and implemented in `src/db/` — the dependency inversion rule 6 describes. Domain and application code never touch the implementation, so the move costs one file.
- Stored values are prefixed `v1.`, and the column name is bound into the GCM tag as additional authenticated data. A scheme change has something to branch on, and a ciphertext lifted from one column into another fails to authenticate rather than decrypting to a plausible wrong answer. An account number that silently decrypts to a _different_ account number is a payment sent to the wrong person.

The development key and pepper are published in `.env.example` and in `src/lib/env.ts`, which is safe because they protect a throwaway local database — and production **refuses to start** if it finds either of them. That refusal is the only thing standing between a published key and a real deployment, so it is tested.

### 6. Prisma 7 with `@prisma/adapter-pg` — a fifth dependency, agreed

Prisma 7.9 no longer accepts connection URLs in `schema.prisma` (they move to `prisma.config.ts`) and `PrismaClient` now requires a driver adapter rather than a URL. Neither was true of the version this task was planned against.

The alternative was pinning to Prisma 6.19, which keeps `url`/`directUrl` in the schema and needs no adapter, holding the agreed four dependencies exactly. Chosen against, deliberately: v7 is current, and the adapter turns out to suit the two-role split — the application client is _constructed_ with the application role's pool in `src/db/client.ts`, while migrations read the owner URL from `prisma.config.ts`. The separation is visible in code rather than resolved from whichever environment variable happened to be set.

`@prisma/adapter-pg` brings `pg` and `postgres-array` as its own dependencies. One direct addition, first-party.

`prisma.config.ts` imports `./src/lib/env` rather than reading `process.env`, so the migration tooling and the application agree on what a valid environment is — and a clean clone can `pnpm install` (which runs `prisma generate`) with no `.env` file.

### 7. The generated Prisma client is not committed

Output goes to `src/db/generated/`, gitignored, regenerated by `postinstall`. Committing it would put a large machine-written tree in every diff and let it drift from `prisma/schema.prisma`, which is the actual source of truth. It is excluded from ESLint and Prettier for the same reason.

### 8. `pnpm test` stays unit-only

The integration project needs a container and takes tens of seconds. Putting that in the gate that runs after every task is how people stop running the gate.

The cost is real and worth naming: the checks most worth having are the ones `pnpm test` skips. `pnpm test:all` runs both, CI runs both, and the README says plainly that a green `pnpm test` is not a green build.

### 9. Podman rather than Docker, with the sharp edges handled in code

The machine this was built on has Podman 5 and no Docker. Two failures follow, both of which read as something else entirely:

- **Testcontainers** looks for a Docker socket and reports an opaque "could not find a working container runtime". `tests/setup/postgres.ts` detects `/run/user/$UID/podman/podman.sock` and uses it, and disables Ryuk — Testcontainers' cleanup sidecar, which needs to mount the socket into a privileged container and cannot under rootless Podman. An explicit `DOCKER_HOST` always wins, so a Docker host is unaffected. The teardown stops the container regardless.
- **SELinux** denies the container access to the bind-mounted init script, and Postgres exits during initialisation with `Permission denied` on a file that is present and world-readable. `compose.yaml` marks the mount `:ro,z`. Docker understands the flag, so it costs nothing elsewhere.

The one thing that cannot be handled in code is `systemctl --user enable --now podman.socket`, which is in the README.

### 10. Two deviations from architecture §4.2, both minor

**No `bank_account_id` on `organisers`.** §4.2 lists it alongside `bank_accounts.organiser_id`, which is a circular foreign key for one guarantee: at most one account in play per organiser. A partial unique index on `bank_accounts (organiser_id) WHERE status = 'active'` gives the same guarantee without the cycle.

**`ledger_entries.event_id` is nullable, with a `collection_id` beside it.** §4.2 assumes every chain belongs to an event, but Part D2.3 allows a standalone collection with no event page — and it still needs a tamper-evident record. A CHECK requires exactly one of the two, so `sequence_no` always means something within a single chain. Genesis uses `SHA256(event_id)` or `SHA256(collection_id)` accordingly.

### 11. Collections have no money path, and a test enforces the absence

Rule 12 and Part H invariant 11. `collections` has no payout relation, no float, no disbursement, no balance and no foreign key to `bank_accounts`. `organiser_bank_hint` is free text — _"Nomsa's Capitec, ending 4471"_ — so members know where to send money, and is deliberately not a `BankAccount`, because a `BankAccount` is something we can disburse to.

The test asserts this **structurally, against the live schema**, not against the Prisma models: no column on `collections` matching `payout|float|disburse|settle|escrow|balance|wallet`, no table named for a float or settlement account, nothing anywhere carrying both a collection and a payout reference. A pattern rather than a fixed list, so a column called `disbursement_id` fails on the day it is written.

That is the point of it. The test is a tripwire for a task nobody has written yet, and it fires even if whoever writes it has never read rule 12.

### 12. The archetype→group mapping is to be generated in M1-04, not duplicated

Decided after M1-02 shipped, and it supersedes the closing note in 3 above.

That entry left the mapping written by hand in two places — the SQL CHECK in `20260807235900_constraints_and_grants`, and the `ArchetypeConfig` still to be built — and proposed a test asserting the two agree.

**M1-04 should generate the CHECK from `ArchetypeConfig` instead.** A test catches drift only once somebody has already written it and only if the test is run; generation makes the two incapable of disagreeing. The distinction matters here more than it usually would, because the thing that drifts is which archetypes count as bereavement, and the consequence of getting it wrong is a progress bar on a funeral.

If generation turns out to fit badly with Prisma's migration workflow — a generated migration has to be a committed, reviewable file, not something produced at deploy time — then the agreement test is an acceptable fallback. **Try generation first.**

---

## M1-03 · Money primitive

### 1. `bigint`, not `number`

Every `*_cents` column in `prisma/schema.prisma` is `BIGINT`, and Prisma hands those back as `bigint`. A `number` representation would mean a conversion at every repository boundary — the exact place a rounding bug hides — and a silent cliff at 2^53.

`bigint` matches the storage exactly. It also removes floats at the type level rather than by convention: no function in `src/domain/money/` takes or returns a `number`, so there is no signature a float could be passed through.

### 2. The type is branded

`type Money = bigint & { readonly [moneyBrand]: 'Money' }`. A raw `bigint` cannot be passed where a `Money` is expected, so an amount cannot enter the type without going through `fromCents` and its range checks.

`a + b` on two `Money` values still compiles — TypeScript allows the operator — but yields a plain `bigint` that will not assign back to `Money`. The friction lands where it should: the shortcut is available for a moment and then refuses to be stored.

### 3. Magnitude only, and the upper bound is the column's

No sign. Direction lives on `ledger_entries.direction`, and M1-02 put `>= 0` CHECKs on every cents column — a negative `Money` would describe something the schema cannot store.

The upper bound is `MAX_CENTS = 9 223 372 036 854 775 807`, Postgres's signed 64-bit maximum, rejected at construction rather than at an INSERT. `add` and `multiply` overflow-check through the same constructor.

`subtract` throws on underflow. There is no negative value to return, and a result below zero is a programming error rather than user input.

### 4. No `divide`, no `allocate` — yet

Division is the only operation here that can lose a cent, and how the remainder falls is a decision that belongs to whoever needs the split, not to a guess made in advance. When a caller needs one, it gets an operation that returns the remainder explicitly rather than a `divide` that quietly absorbs it.

### 5. The formatter is hand-rolled, and the tests assert code points

`Intl.NumberFormat('en-ZA')` emits a **non-breaking space** (U+00A0) as the group separator, and the decimal separator is not reliably a comma across Node and ICU versions. Rule 7 fixes the glyphs exactly: U+0020 between thousands, U+002C before the cents.

A non-breaking space is indistinguishable from a plain one in a diff, in review and in a terminal. It would pass every string-equality test written by eye and then break something unrelated much later — a snapshot, a PDF, a width calculation — for a reason nobody can see. So `tests/unit/money.test.ts` asserts the separators by code point and asserts that U+00A0, U+2007, U+2009, U+202F and U+002E never appear in output.

Swapping the one character in `THOUSANDS_SEPARATOR` to U+00A0 fails 13 tests. That was checked, not assumed.

### 6. `formatMoneyWhole` drops the cents only when they are exactly zero

`R5 000` for `500000n`, `R5 000,50` for `500050n`, never a rounded `R5 001`. Built now rather than in M2 so nothing has to re-enter the domain layer to add a formatter — the group bead in rule 14 is its caller.

### 7. `parseMoney` returns a result and rejects rather than guesses

It returns `{ ok: true, value } | { ok: false, reason }` rather than throwing, because it runs on untrusted contributor input at the Zod boundary (§10) where failure is an expected outcome with copy attached. The reason is a code, never a sentence — user-facing strings live in `src/copy/`, keyed by archetype (rule 11).

Accepts an optional `R`, five kinds of space as thousands separators, either `,` or `.` as the decimal separator, bare integers (`5000`) and bare decimals (`50.5`). Someone on an Android keyboard reaches for the dot; someone writing it the South African way reaches for the comma; someone in a hurry reaches for neither.

Two rejections are deliberate and both are about not guessing:

- **Three or more decimal places are rejected, never rounded.** Turning R10,555 into R10,56 changes what somebody contributed without telling them.
- **`1,234` is rejected as `too-many-decimals`.** It is R1 234 to one typist and R1,23 to another. Two separators (`1,234.56`) is rejected for the same reason. The form asking again is much cheaper than misreading an amount.

### 8. Errors carry the reason, never the amount

`MoneyError` messages say "cannot be negative", not which value was negative. These messages reach logs, amounts on a bereavement event default to hidden (§7.3), and this is the same reasoning that keeps ciphertext out of `ColumnCipherError`.

### 9. Named exports, not a `Money.add(…)` namespace

A namespace object cannot be tree-shaken, and the formatters get imported by the public event page, which has a build-failing 150 KB budget (rule 9).

`src/domain/index.ts` re-exports the **type** only. `add` and `sum` mean nothing at that level and would collide with the next module needing those names, so operations are imported from the module that owns them: `import { add, formatMoney } from '@/domain/money'`.

### 10. `fast-check` added as a devDependency

Approved before writing. Dev-only, never in the bundle. The value is shrinking: on failure it reports the minimal counterexample and the seed, and a 19-digit random counterexample nobody can read is barely better than no test at all.

The done-criterion — no precision loss across 10 000 random operations — is met by four properties each running 10 000 cases (add/subtract inverse, add against raw bigint addition, and both formatters round-tripping through the parser), rather than by a total summed across the file. The remaining properties run 1 000 cases each and cover the algebraic laws that a lossy representation would also break.

---

## M1-04 · Archetype system

### 1. Accents come from CLAUDE.md, not from the prototype

`design/setup.html` and CLAUDE.md · Part C.2 disagree on four of six accents, and the prototype writes bereavement's as the literal `#16233D`.

CLAUDE.md wins, and the tell is decisive: `#16233D` **is** the fallback colour spelled out, which is precisely what rule 2 forbids. The prototype rendered correctly anyway, because every accent reached the page through `var(--accent, …)` — so nothing in it could ever have caught a wrong value. Two documents agree against one that had no way to fail.

Everything else from the prototype — flags, sample copy, consequence strings — is authoritative and was taken verbatim.

| Group       | Config    | `design/setup.html` |
| ----------- | --------- | ------------------- |
| Union       | `#8C2F22` | `#8C2F22`           |
| Bereavement | _omitted_ | `#16233D`           |
| Remembrance | `#2C4A7C` | `#2F5D50`           |
| Arrival     | `#4A7C59` | `#8A6A12`           |
| Achievement | `#C89211` | `#8C2F5E`           |
| Gathering   | `#A6742B` | `#2C4A6E`           |

### 2. Seven configs, six groups

`ArchetypeKey` has seven members and the prototype has six kinds. `umembeso` has no prototype entry and takes the union flags — same group as `umshado`, same register.

Two kinds use a different Zulu word in the prototype than the schema and glossary do. `graduation` keeps the prototype's **Umgidi** — the celebration itself. `itiye` does **not** keep "Umhlangano": the enum and the glossary both say _itiye_, and umhlangano is a meeting rather than a hosted tea, so it is also the less accurate word.

### 3. `accent` is absent on bereavement, and cannot be `undefined`

`exactOptionalPropertyTypes` is already on, so `accent: undefined` does not compile. "No accent" therefore has exactly one spelling — the key is not there — and there is no second state for a reader to misinterpret. A `@ts-expect-error` in `tests/unit/archetype-types.test.ts` holds that.

`animate: false` is written out on bereavement rather than omitted, per Part C.1. The test asserts the property is **present**, is a boolean, and is `false` — not merely that `config.animate` is falsy, which would also pass for a config that never declared it.

### 4. Targeting and motion are separate types

`TargetedArchetype` (`allowsTarget: true`, `allowsProgressBar: true`) and `AnimatedArchetype` (`animate: true`). A component asking for a target declares the first; anything that moves declares the second.

They are not one "celebratory" flag because collapsing them would be wrong in both directions: `umbuyiso` carries a target and permits no motion, and `imbeleko` animates with no target at all.

Configs are `as const satisfies Record<ArchetypeKey, ArchetypeConfig>`, so each flag keeps its literal type and `ARCHETYPES.umngcwabo` is simply not assignable to `TargetedArchetype`. `archetypeFor(key)` returns the wide `ArchetypeConfig` on purpose: a runtime-chosen archetype must be narrowed with `isTargeted` before it can reach a progress bar.

### 5. The render guard throws in development and fails closed in production

Architecture §6 says the runtime guard throws in development. It does. In production it returns `false`, reports, and renders nothing.

A progress bar that silently fails to appear on a funeral is a bug we can live with. A 500 on the funeral page, for a family who have just sent the link to fifty people, is not. Failing closed means the forbidden element does not render either way — the difference is only whether the page survives.

`src/domain/archetype/guard.ts` is pure and decides what a violation _is_. `src/lib/archetype-guard.ts` decides what to do about one, because that needs `NODE_ENV` and a way to report. The report carries the archetype, group and feature and nothing else — no event, no slug, no person (rule 8).

### 6. `copy: ArchetypeCopy` is deliberately not on the config yet

Part C.1 lists it; Part D says extract the strings from `design/*.html` **verbatim** and do not paraphrase. The reference screens carry full copy for two archetypes. Writing the other five here would produce exactly the paraphrase Part D forbids, in the file everyone would later assume had been reviewed. It lands with `src/copy/`.

`verb` and `consequences` are populated now, because both are determined by strings that already exist in the prototype.

### 7. `consequences` are composed from the flags, and sit awkwardly in `domain/`

The prototype builds the four consequence lines from the archetype's own flags rather than writing them per kind, and `consequencesFor` does the same. This is not the conditional rule 2 forbids: nothing asks _which archetype it is_, only what the archetype permits. Writing the same four sentences seven times would create 28 opportunities to correct a typo in one place and not the other six.

These are user-facing strings inside `src/domain/`, which cuts against rule 11. Part C.1 puts `consequences` on the config, so that is where they are for now. **When `src/copy/` lands, they should move there** and the config should reference them — the flags stay, the sentences go.

### 8. The SQL mapping is generated; the migration is a new one

Per M1-02 §12. `scripts/archetype-constraint.ts` builds the two CHECK constraints from `ARCHETYPES`.

The M1-02 migration cannot be edited — Prisma checksums applied migrations, and rewriting one breaks every database it has run on — so generation emits a **new** migration that drops both constraints by name and re-adds them. It is a no-op today by construction: the generated mapping is byte-identical to the hand-written one it replaces. From here it is generated, which is the point.

**Workflow. Do not hand-edit `prisma/migrations/*_archetype_group_mapping_generated/migration.sql`.**

1. edit `src/domain/archetype/archetypes.ts`
2. `pnpm archetype:sql`
3. commit the migration

Adding or renaming an archetype needs a **new** timestamped directory, not a rewrite of the existing one — change `MIGRATION_DIR` in the script first.

Two tests hold this together: a unit test asserts the committed file is byte-identical to current generator output, and an integration test reads `pg_get_constraintdef` back out of a live Postgres and checks it against `ARCHETYPES`. The second one is what catches a generated migration that was never applied, which looks identical from the first.

The comparison is byte-identical on purpose. Parsing the SQL, sorting the arms or normalising whitespace would let a hand-edit survive as long as it happened to mean the same thing — which is the habit the workflow exists to prevent.

### 9. `allowImportingTsExtensions` added to tsconfig

`scripts/archetype-constraint.ts` runs under `node --experimental-strip-types`, which requires the explicit `.ts` extension on its import. Safe with `noEmit`, and it costs nothing elsewhere.

### 10. Two things noticed, not done

**A generalised target constraint is now possible.** The database enforces "no target on bereavement". The config knows `allowsTarget` per archetype, and `imbeleko` also declares `false` — so a generated CHECK could enforce _"no target unless this archetype permits one"_ and the two would never drift. That is a behaviour change beyond what M1-04 asked for, so it is flagged here rather than taken.

**`allowsCountdown` on `umbuyiso` is a judgement call.** The prototype has no countdown flag, so there was nothing to extract. It is `false`: an unveiling keeps hidden amounts and no motion, and counting down the days to a tombstone unveiling reads wrong in the same way a progress bar on a funeral does. Worth a second opinion.

---

## M1-05 · Design tokens, fonts, UI primitives

Settled content is written up in [design-system.md](design-system.md). This records the decisions and their cost.

### 1. Fonts fetched from Fontsource, committed, and hash-pinned

`public-sans:vf@5.3.0` from jsdelivr — the exact files the prototypes load, and the sizes Part G budgets against.

| File                          | Bytes  | SHA-256                                                            |
| ----------------------------- | ------ | ------------------------------------------------------------------ |
| `public-sans-latin.woff2`     | 26 832 | `5ed4d31c988e73b258894244f209069ebe77dc7e564861954b21198b6de90d68` |
| `public-sans-latin-ext.woff2` | 18 472 | `3a00a32f0242b723dcea79935747d6d27dd93675d03ef23f470dfe274e79586a` |

The hash test is the point. A swapped font binary produces no error anywhere — different metrics, possibly a different subset, and a rendering difference nobody traces back to the file. A test that fails on the byte is the only thing that catches it.

The `@font-face` rules are hardcoded rather than fetched by URL or generated by `next/font`, because the design pipeline re-added the Vietnamese subset twice when a URL was involved. A test asserts no source file mentions `fonts.googleapis.com`, `fonts.gstatic.com`, `cdn.jsdelivr.net` or `fontsource`.

### 2. No accent map in CSS — the config is the only source

`ArchetypeTheme` sets `--accent` inline from `config.accent`, and sets nothing when the config declares none.

The alternative — `[data-archetype='umshado'] { --accent: … }` and five more — repeats the six colours that already live in `ArchetypeConfig`. That is the duplication M1-04 built a generator to remove, and here the fact that would drift is _which archetype has no accent at all_. Reading it from the config means the CSS cannot disagree with the domain, because the CSS does not know.

Three tests hold the mechanism, and each catches a different well-meaning change:

- **No stylesheet declares `--accent`.** This is the one that matters. `--accent: #16233D` in `tokens.css` as a "default" renders identically and silently ends the fallback: every archetype would inherit indigo from that file rather than from the absence of a decision, and bereavement would stop being the case that proves it works.
- **No stylesheet selects on a specific archetype**, and none contains an archetype key, group name, or accent literal.
- **Every `var(--accent…)` carries the `#16233d` fallback.** A bare `var(--accent)` renders nothing at all on a funeral page.

Comments are stripped before those scans — this file and `tokens.css` both quote the forbidden patterns while explaining them.

### 3. `--accent-strong`: two of the six accents cannot carry white text

Measured: achievement `#C89211` reaches 2.8:1 on white and gathering `#A6742B` reaches 4.1:1. Both are below 4.5:1 and gold is below even the 3:1 large-text floor, so a solid accent button with white text is an axe failure in two of six themes.

**This is a consequence of taking CLAUDE.md's palette over the prototype's** (M1-04 §1). The prototypes did not hit it because their achievement and gathering slots held darker colours. The decision to follow CLAUDE.md stands; this is the bill for it.

`tokens.css` derives `--accent-strong` as `color-mix(in srgb, var(--accent, #16233d) 60%, #16233d)` — the accent darkened toward ink, hue intact, inside the family palette, clearing 4.5:1 for all six plus the fallback. Pure `var(--accent, …)` stays correct wherever the colour is not behind text.

It is declared on `[data-archetype]` rather than `:root` because a custom property resolves where it is declared: in `:root`, the inner `var(--accent, …)` would resolve to the fallback before any theme exists and every archetype would inherit one indigo value.

A unit test reproduces `color-mix(in srgb, …)` exactly — channel-wise interpolation in gamma-encoded sRGB — and asserts 4.5:1 for every accent. It fails in a second and names the colour; axe remains the authority at render time. Reverting the primary button to the unmixed accent was checked: axe reports contrast violations in the achievement and gathering themes and nowhere else.

**If the palette changes, re-check this.** The 60% ratio is not a magic number, it is the smallest round figure that cleared every accent in the current six.

### 4. Errors are not carried by colour

Part C.2 defines no error colour. Rather than invent one, an invalid field is marked by a 2px ink border, bold text, a rule beside the message, `aria-invalid` and `role="alert"`.

Two reasons. An untested hue would make its debut on the most stressful screen in the product, and colour alone is not a signal a screen reader or a colour-blind reader receives. If an error colour is wanted later it should be chosen deliberately and added to Part C.2, not improvised in a component.

### 5. Sheet and Toast ship no client JavaScript

`Sheet` renders a native `<dialog>`; `Toast` renders a live region. Both are presentational: `open` is a prop, not state, and there are no timers.

Native because the browser already does focus trapping, `Esc`, page inertness and the backdrop, and does them correctly on an old Android browser. Presentational because opening, dismissing and the 15-second `Undo` belong to the flows that use them (M1-07, M2) — flows that must work with JavaScript disabled (rule 5). A primitive that assumed a click handler would quietly rule that out.

### 6. `/dev/tokens` answers 404 in production

`notFound()` when `NODE_ENV === 'production'`, plus `robots: { index: false }`. It is an internal reference, and a route nobody linked to is still a route somebody can find.

### 7. `@axe-core/playwright` added as a devDependency

Approved before writing. Dev-only. There is no way to satisfy "axe reports zero violations" without it. It runs page-wide and once per theme — scoped as well, so a failure names the theme instead of leaving somebody to find which of six columns broke.

### 8. Visual regression deferred

Part H lists a visual project across all six archetypes. It is not in M1-05's done criteria, and baselines committed against primitives that have not settled generate noise that teaches people to ignore the suite. Revisit once the Ledger Strand and the needs board exist.

### 9. Type ergonomics: iterating `ARCHETYPES` needs an annotation

`as const satisfies` means the bereavement member genuinely has no `accent` property, so `Object.values(ARCHETYPES).map((c) => c.accent)` does not compile. The fix is one annotation — `const CONFIGS: readonly ArchetypeConfig[] = Object.values(ARCHETYPES)` — and it appears in three files now.

Worth knowing rather than fixing: the friction is the type system correctly reporting that "absent" and "undefined" are different, which is the same distinction the accent mechanism depends on.

---

## M1-06 · Auth (organiser)

### 1. Hand-rolled sessions, not Auth.js — an explicit deviation from the stack table

The stack table in architecture §3 says "Auth.js, OTP-first". This does not use it, deliberately. **Do not "correct" this back to Auth.js without reading the rest of this entry.**

Auth.js has no phone-OTP provider. Phone OTP means its Credentials provider, and **Credentials forces JWT sessions** — the database session strategy is not available there. A JWT cannot be withdrawn before it expires, and two things we have already committed to require exactly that:

- Architecture §10: payout approval re-authenticates **regardless of session age**.
- A stolen phone needs "sign out on every device", now, not in thirty days.

The workaround is to keep our own session table beside Auth.js's JWTs — which is carrying the dependency for none of its value. What replaced it is about two hundred lines we control: a 32-byte random token in an `HttpOnly` `__Host-` cookie, its SHA-256 in `sessions`, and revocation as a column.

If a future task needs social login or a second identity provider, revisit this. Nothing about the deviation makes that harder — `sessions` is a table, not a protocol.

### 2. Two new tables, and `display_name` became nullable

Architecture §4.2 never covered auth, so `otp_challenges` and `sessions` are additions rather than deviations.

`organisers.display_name` is now nullable. The record is created by the **first successful verification**, at which point we hold a phone number and nothing else. Asking for a name on the sign-in form would mean asking only for numbers we do not recognise — which answers "is this number registered?" for anybody who cares to check. The name arrives at setup (M1-07).

Both tables needed an explicit `GRANT UPDATE`, because M1-02's default privileges give a new table `SELECT, INSERT` only. That is the default working as intended: the grant is one line in a migration a reviewer can see. Neither table gets `DELETE` — expiry is a timestamp, rows are evidence, and retention pruning is the owner's job on a schedule.

### 3. Codes are HMAC-SHA256 under `OTP_PEPPER`

A six-digit code is a 10⁶ space. A plain SHA-256 of one is not a secret — the entire space precomputes in about a second, so a stolen `otp_challenges` row would be a lookup, not an attack. The pepper is the only thing that makes the stored value useless on its own, which is why it lives outside the database.

Separate from `ID_NUMBER_PEPPER` on purpose: rotating this one costs the codes in flight and the ability to correlate old audit rows; rotating that one invalidates every stored identity hash. They should not share a fate. Same stopgap as the other key material — it belongs in a KMS, and `.env.example` says so.

The same pepper hashes the phone, IP and user-agent for the audit log, with a domain-separating prefix (`ip:`, `ua:`) so one kind of identifier cannot collide with another.

### 4. Rate limiting counts rows in Postgres, not Redis

Redis is in the stack for BullMQ and is not installed. Adding a service for a counter that can be read transactionally from a table we are already writing is the wrong trade, and _approximate_ is a poor property for something gating account access. Move it when BullMQ lands, if there is a reason to.

Limits: **3 per number per hour**, as specified, and 12 per IP per hour alongside — one phone per attacker is not the threat model. The IP limit is well above the number limit because a household, an office or a taxi rank behind one NAT is a real thing and must not lock its own people out.

### 5. `x-forwarded-for` is client-controlled, so the per-IP limit is a speed bump

Found while writing the E2E suite, which tripped its own IP limit: Next sets `x-forwarded-for` in development, so every test looked like one client.

The header an attacker cannot choose is `cf-connecting-ip` — Cloudflare sets it and strips any copy the client sent. `requestFingerprint` now prefers it, then `x-real-ip`, then the first `x-forwarded-for` entry.

**Naming the limitation rather than hiding it:** with a client-supplied `x-forwarded-for`, the per-IP limit is evadable by anybody willing to rotate a header. It is a speed bump on casual enumeration. The per-number limit is the one that holds, because a number is not something the requester gets to invent. Deployed behind Cloudflare the IP limit is real; anywhere else it is best-effort.

### 6. The development SMS sender writes nothing, anywhere

Every OTP tutorial prints the code in development. Development logs end up in aggregators, in screen shares, and pasted into issues — "it is only development" is how codes leak, and the done-criteria say no OTP appears in any log.

So the dev sender holds the last message per number in memory and Playwright reads it through `/dev/sms`, which `notFound()`s in production exactly like `/dev/tokens`. No stdout, no file, no logger. In production `smsSender()` **throws** rather than falling back to a sender that delivers nothing — silently dropping a code somebody is waiting for is worse than failing at the point of the missing configuration.

**No SMS provider has been chosen, and it is not in the open-items list.** It should be. The interface is small (`SmsSender.send`), so choosing one is an adapter and a credential rather than a change to the flow.

### 7. `tests/unit/auth-no-code-in-logs.test.ts` is a source scan, on purpose

It reads every file on the auth path and fails if any of them calls `console.*`, `logger.*` or `process.stdout`, puts the code in a redirect or an error, writes it to a column, mentions WhatsApp, or writes a phone number anywhere but a hash.

Not "does not log the code" — **does not log**. The failure it guards against is somebody adding a `console.error(error)` while debugging a delivery problem, which is precisely when it feels reasonable. A behavioural test would pass on the day it was written and say nothing about the day after.

### 8. Enumeration and brute force

- **The reply never reveals whether a number is registered.** Sent, rate-limited and never-seen all land on the same page with the same sentence. Only whether an SMS goes out differs.
- **Wrong, expired and never-existed share one message.** Three messages would let somebody guessing tell which of the three they hit, which is a map of which numbers are real.
- **Six attempts ends a challenge.** Six digits with unlimited guesses falls in minutes to a script.
- **Consuming a challenge is a conditional update.** Two requests carrying the same valid code race; exactly one updates the row, and the loser is a failed attempt rather than a second session.
- **Only the newest unconsumed challenge is checked**, so an older SMS still sitting in an inbox is not a working key.
- Constant-time comparison everywhere, and a malformed stored hash is a failed match rather than a 500 on the sign-in page.

### 9. `prisma migrate dev` cannot run against this schema

`prisma migrate dev` applies every migration to a shadow database first, and `20260807235900_constraints_and_grants` ends with `REVOKE ALL ON "_prisma_migrations"` — a table the shadow database does not have. It fails there, on a migration that is already applied and therefore cannot be edited.

**The workflow for this repository is hand-written migration SQL verified with `prisma migrate deploy`**, which is what M1-02 did and what this task did. `npx prisma migrate diff --from-config-datasource --to-schema=prisma/schema.prisma` reports "No difference detected" when the hand-written SQL and the schema agree, and that is the check to run before committing one.

### 10. The sign-in flow works with JavaScript disabled

Plain `<form>` elements posting to server actions, errors carried back as a code in the query string and turned into copy by the page. A returned value would be dropped on a page with no script and the person would see the form again with no explanation.

There is an E2E test with `javaScriptEnabled: false` that signs in completely. Rule 5 asks for this on the claim flow; it costs nothing here and the same borrowed phone is on both paths.

### 11. `/account` is a placeholder

A login flow with nowhere to land cannot be tested end to end. It shows that you are signed in and carries both sign-out actions. M1-07 replaces it with the real dashboard.

---

## M1-07 · Event creation flow

### 1. The draft row is created at the details step, not before

`events.title` is `NOT NULL`, so no row can exist until there is a name. The kind travels in the query string (`/create?kind=umngcwabo`) — an archetype key, not personal data — and everything after the details step edits a row that exists.

The alternative, accumulating six steps of state in a cookie, cannot hold a needs list and loses everything on a flat battery. This way a dropped connection resumes.

### 2. Need templates are static application data in `src/copy/`, and this corrects M1-04

M1-04 recorded that `needsTemplate` points at seed rows arriving in M2. That was wrong: **there is no `need_templates` table and there should not be one.** A template seeds a new event's `need_items` at creation and then has no further existence — the organiser owns the list from that moment, and editing it must not change anybody else's.

They are user-facing strings, so they live in `src/copy/need-templates.ts` (rule 11), taken verbatim from `KINDS[].needs` in `design/setup.html`. `umembeso` has no prototype entry and takes `umshado`'s list — same group, same register.

### 3. `need_items.note`, and no parsing

The setup screen asks "How much, or how many" as one free-text field. The answers are _"Around R1 200 to hire"_, _"For 200 people"_, _"2 head"_ and _"Mealie meal, rice, sugar, oil"_.

The last of those has no quantity in it. Parsing that into `quantity_required` / `unit` / `estimated_cost_cents` would turn a grocery list into "1 unit" — data loss that reads like data, on the page a bereaved family is about to share. So the note is stored as written, `quantity_required` defaults to 1, and the structured columns wait for M2-03 where partial claiming actually reads them.

### 4. `events.subtitle` and `events.place` — added beyond what was agreed

**Flagging this because it was not in the approved file list.** The details step collects four things and the schema had homes for two. `subtitle` is the line under the title — a clan name (_uMaZondi_), the other partner — which `design/event.html` renders directly beneath it. `place` is the area, and the screen is explicit that it is the area rather than the street.

The alternative was folding both into `description`, which would leave the public page parsing prose back into fields it once had. Two nullable text columns in the same migration seemed better than losing two of the four answers, but it is a scope decision somebody else might have made differently.

### 5. The verify step renders and collects nothing

M3-01 (the Home Affairs adapter and the peppered ID hashing) does not exist. Three options, and the third was taken:

- **Collect and discard** — the worst available outcome. All of the POPIA exposure, none of the benefit, and an organiser who reasonably believes they have been verified.
- **Collect and store** — impossible without M3-01's hashing path.
- **Render the copy, collect nothing, say so.** The step carries "what we check" and "why this cannot be skipped" verbatim from the design, plus a panel stating plainly that the check is not switched on and that nothing about them is stored by this step.

`canPublish` deliberately has **no verification clause**. A check against a status nothing ever sets would be a gate that always passes — worse than no gate, because it looks like one. M3-02 adds it, and a test in `tests/unit/event-setup.test.ts` records that its absence today is deliberate.

### 6. Abakhaphi are stored, and nothing is sent

Witness rows are written as `invited` and no message goes out — no SMS provider is configured (M1-06 §6). The design's "what they will be asked" panel is future tense, which stays true, and **no copy anywhere claims a message was sent**. A unit test asserts the tense.

### 7. `/e/[slug]` exists now, as a stub M1-08 replaces

"Drafts are not publicly reachable" is a property of a route. Testing it only at the repository layer is how a page later ships with the filter missing, so there is a route, and an E2E test reads a real draft's slug from the database and asserts a 404.

The first version of that test asserted a made-up slug 404s, which would have passed with the filter removed. It now reads the draft's actual slug, and with `status: 'published'` deleted from `publicEventBySlug` it fails as it should.

The route file says at the top that M1-08 replaces it. Two things should survive that rewrite: the `published` filter living in one repository function rather than in each route, and `noindex`.

### 8. Every step is a form post

Adding a need, removing a witness and publishing are submit buttons carrying a name and a value, not click handlers. The whole six-step flow completes with JavaScript disabled, and there is an E2E test that does exactly that.

One consequence worth knowing: a submit button carries one name-value pair, so "remove" identifies itself by the index it sends rather than by also setting `action`. Every path saves what is on screen first, so removing the third row does not discard what was typed into the fourth.

### 9. Reads are scoped to the organiser; publishing is a conditional update

`draftForOrganiser` filters on the organiser id, so somebody else's draft is indistinguishable from one that does not exist. An id in a URL is not a permission.

`publishDraft` is `updateMany` with `status: 'draft'` in the filter, so two taps on a slow connection publish once and the second returns false.

### 10. `archetypeGroup` comes from the config, never from the form

The denormalised group is read from `ARCHETYPES[archetype].group` at creation. A hidden input carrying it would let a tampered form claim `umngcwabo` with group `union` — the CHECK constraint would catch it, but as a 500 rather than as something impossible. An integration test asserts the group on a created funeral.

### 11. The setup progress rule is not a progress bar

`SetupShell` draws a rule that fills as the six steps advance, and it renders identically on a funeral. It is a position in a form, not progress toward an amount — rule 1 concerns progress toward money raised, and this component is never handed an amount. Worth stating because the two look alike in a screenshot.

---

## M1-08 · Public event page + performance gate

### 1. The public event page is a route handler, not a page — because 199KB

Measured before writing anything: the M1-07 stub, an App Router page with **zero client components** and no interactivity, shipped a **199KB first load**. 174KB of it was Next's App Router client runtime — React, the router, the Turbopack runtime — which ships whether or not a route has a client component. Next 16 offers no way to remove it; `inlineCss`, `cssChunking` and `prefetchInlining` were all checked.

The ceiling is 150KB (rule 9) and Part G budgets ~62KB typical. Those numbers were written for a page that does not carry a framework runtime.

So `/e/[slug]` is rendered with `renderToStaticMarkup` and served from a route handler, with the tokens and page CSS inlined into the head. Measured, same build, same fixture: **30.8KB first load, zero JavaScript, LCP 0.61s on slow 3G.**

The alternative was to set the gate at a number the page could pass. That is worse than no gate: a green gate at a reverse-engineered threshold has stopped measuring anything, and in six months nobody remembers the number was chosen to be green.

**Do not convert this back to `page.tsx`.** It typechecks, it renders identically, and it puts 174KB back. Part G.1 now records the measurement for the same reason.

### 2. `react-dom/server` has to be imported at runtime

Next refuses a static `import { renderToStaticMarkup } from 'react-dom/server'` in app code — "render or return the content directly as a Server Component instead". The check is on the static import, so the route does `await import('react-dom/server')` inside the handler.

It looks like a workaround and it is one. The rule exists to stop people double-rendering inside a server component; this route is not a server component and has no client runtime to hand off to.

### 3. Next does not compress a route handler's response

Found by the gate reporting `content-encoding: identity` for 13.3KB, where `/sign-in` came back gzipped. Next compresses what its own rendering pipeline produces, not a raw `Response`.

Cloudflare would compress at the edge (architecture §3), but relying on that ships ten extra kilobytes anywhere the edge is not — staging, a direct origin hit, a region that fails open. `src/lib/http-compress.ts` negotiates brotli, then gzip, then identity, and sets `Vary: accept-encoding`. 13.3KB → 4.6KB.

Brotli quality 5 rather than the default 11: within a few hundred bytes of maximum on this document and roughly twenty times faster, and the response is cacheable anyway.

### 4. `tokens.css` is generated from `src/ui/tokens.ts`

The tokens now have to exist twice — as a stylesheet the App Router pages import, and as a string the route handler inlines, because a route handler cannot import CSS.

Same pattern as the archetype SQL in M1-04, same reason: two hand-maintained copies drift, and what drifts is a colour nobody notices is wrong, or an `--accent` declaration that quietly ends the bereavement fallback. `pnpm tokens:css` regenerates; a unit test fails if the committed file is not byte-identical to the generator's output.

`accentStyle()` was extracted at the same time. There are now two renderers — `ArchetypeTheme` and the public page's own document — and the test asserting `--accent` is set in exactly one place caught the duplication as soon as it appeared. One function decides that "no accent" means the key is absent.

### 5. Two strings from the prototype are not shipped as written

`design/event.html` is the copy source of truth, and two of its lines are not true today. Both would be read by a contributor immediately before deciding whether to send money.

**"Money you send goes to a held Isipheko account for this ceremony, never to a personal account."** That is Mode B, which is gated on a legal opinion (architecture §15 item 1) and is not built. Today the organiser is paid directly. What ships instead: _"Nothing on this page can take money from you yet. When contributing opens, you will be told exactly where your money goes before you send it."_

**"Organiser's ID verified by Isipheko on 12 July."** Identity verification is M3-01 and nothing has been verified. What ships: _"This organiser has not been verified yet. Ask someone you already know before you give."_ The verified wording exists in `src/copy/event.ts` for when it is true.

A badge nobody earned is worth less than no badge and costs more — it teaches people that the badge means nothing. E2E tests assert both absences.

### 6. The gate measures transferred bytes, not file sizes

`fetch` decompresses transparently, so the first version of the gate reported 13.3KB where the wire carried 4.6KB. It now uses `node:http` and counts raw chunks. A gate that is wrong in the safe direction is still reporting a number nobody can check against a browser's network panel.

It reports the English page and the worst case separately, because `unicode-range` makes latin-ext lazy: an English page never pays the 18.5KB, an isiZulu page does, and both should be visible.

### 7. LCP is measured by the gate, not the E2E suite

Playwright rather than Lighthouse — already a dependency, less flaky, and reading `largest-contentful-paint` from a `PerformanceObserver` over CDP throttling measures the same number.

It lives in `pnpm gate:size` rather than the E2E suite because the E2E suite runs against `pnpm dev`, where nothing is minified and modules compile on demand. A paint time measured there says nothing about what a contributor waits for. Part G is explicit: measure the production build.

Throttling is slow 3G — 400kbps down, 400ms round trip — which is harsher than Part G's "throttled 3G" and closer to a prepaid bundle in KwaZulu-Natal.

### 8. What is not on the page yet

The Ledger Strand is M2-06 and there are no contributions; claiming is M2-03. Rather than render an empty frame, the page says what is true: _"Nobody has been recorded here yet"_ and _"Claiming opens shortly"_. Both strings are in `src/copy/event.ts` and go when the real thing lands.

The check code is the first six characters of the slug, upper-cased. M2-02 owns reference codes properly.

---

## M2-01 · Ledger core

### 1. The hash covers two fields §4.3 did not — a strengthening, not a deviation

§4.3 specified `sequence_no || entry_type || direction || amount_cents || reference_id || prev_hash || created_at`. That leaves `in_kind_description` **outside** the chain, so _"the tent"_ could be edited to _"a chair"_ and every hash in the record would still verify.

The threat model is somebody with database write access — the only person who can alter a historic row at all, since the application role holds no UPDATE or DELETE on `ledger_entries`. Leaving the one free-text field outside the hash is a hole in exactly the place the product's central claim lives, and in-kind is the core of what _isipheko_ means: the description **is** the contribution. `contribution_id` is included for the same reason.

**§4.3 has been updated to match**, so the document and the code do not disagree about what the trust artefact protects.

### 2. The serialisation format is pinned by a fixed vector

Fields are joined with U+001F and a NULL is written as U+0000 — both characters Postgres refuses to store in a text column, so no description can forge a field boundary and an absent value is distinguishable from an empty one.

Changing this does not require a migration; it **invalidates every chain ever written**. Every stored `entry_hash` stops matching its row, the nightly verifier alerts on every event, and there is no way left to tell an altered row from a re-serialised one.

A reformat would pass typecheck, pass lint, and pass every test that computes both sides with the same new code. So `tests/unit/ledger-hash.test.ts` writes the canonical string out literally and hashes it from first principles rather than by calling the code under test. Dropping `in_kind_description` from the hash fails six tests, including that vector — checked.

### 3. `created_at` is supplied by the application

The hash covers it, so it has to exist before the INSERT. The column keeps its `now()` default for anything bypassing the repository. `TIMESTAMP(3)` stores exactly the milliseconds `toISOString()` writes, and an integration test round-trips a value with non-zero milliseconds — if the column truncated, every row would fail its own hash the moment it was read back.

### 4. No synthetic genesis row

§4.3 reads as "the first entry uses `prev_hash = SHA256(chain_id)`", not "insert an empty row first". So the first real contribution or payout is sequence 1. A row that means nothing is a row somebody has to explain later.

Because the genesis hash is derived from the chain id, a set of entries lifted wholesale from another event verifies internally but reports `wrong-genesis` here. A chain cannot be grafted.

### 5. Advisory lock as the mechanism, unique index as the backstop

`pg_advisory_xact_lock(hashtextextended(chain_id, 0))` inside the append transaction. Writers on one chain serialise; writers on different chains do not wait on each other, which matters because a busy Saturday is many funerals at once.

The unique indexes on `(event_id, sequence_no)` and `(collection_id, sequence_no)` stay as the thing that makes a gap or a duplicate impossible if the lock is ever wrong. Removing the lock was tried: 25 concurrent appends produce a stream of `Unique constraint failed on the fields: (event_id, sequence_no)` — the backstop holding, the mechanism absent.

### 6. A reversal points at the entry it reverses

`reference_id` on a `reversal` holds the id of the ledger entry being corrected, not of the contribution behind it. With more than one correction the latter loses which entry was reversed, and more than one is exactly when the record has to be unambiguous. Same amount, opposite direction, and the original stays where it is.

`appendReversal` refuses an entry from a different chain rather than silently writing a reversal that points at a stranger.

### 7. The verifier prints no amounts, names or descriptions

Its output goes to build logs and alerts — widely readable, long-lived. A bereavement event hides amounts specifically so a grieving family is not ranked by them, and a verification tool that dumped them into a build log would undo that somewhere nobody thinks to look. Chain id, sequence number, which hash disagreed. A unit test asserts a report carrying a tampered amount and description contains neither.

It connects as the **application role**. A verifier needing elevated privileges to read the ledger would be a second way in.

### 8. `src/db/repositories/ledger.ts` uses relative imports, unlike its siblings

`scripts/verify-ledger.ts` runs under `node --experimental-strip-types`, which resolves no tsconfig aliases. A custom resolve hook was written and tried — and **Node 22.22 silently disables its own type stripping the moment one is registered**, so every `.ts` import fails with `Unexpected token 'export'`. The hook was deleted.

The alternative was writing the two ledger queries a second time inside the verifier. A nightly verifier that reads the chain differently from the code that wrote it is exactly the drift that makes a verifier worthless, so the inconsistency sits in the import lines instead, with a comment saying why. `src/domain/money` and `src/domain/ledger` grew explicit `.ts` extensions on their internal imports for the same reason.

If more ops scripts need app code, the answer is probably a dev-only TypeScript runner rather than more relative paths — worth revisiting then, not now.

---

## M2-02 · Reference codes

### 1. The spec's third example was impossible, and the plan is corrected

M2-02's done-criteria said `mth-4k7b2x`, `MTH-4K7B2X` and `MTH-4KZBZX` all resolve to the same contribution. Against a stored `4K7B2X`, that third spelling needs `Z→7` in position three and `Z→2` in position five. No function maps one character to two, and aliasing `7` and `2` to a common symbol would halve the alphabet in the worst possible place.

Part C.5 and §5.2 both define the normalisation as "(0/O, 1/I/L)" — exactly Crockford's documented aliases, which is self-consistent. The example was wrong, not the rule. `docs/implementation-plan.md` now reads `MTH-40G1BX` resolving from `mth-40g1bx`, `MTH-4OG1BX` and `MTH-4OGLBX`, with the reason inline so the wrong example does not outlive this session.

### 2. "No collisions" is the index, not the generator

32^6 ≈ 1.07 × 10^9. The birthday bound over 100 000 draws predicts about **4.7 collisions**, so a generator trusted to be unique would produce duplicates occasionally and a test asserting zero would be flaky rather than passing.

Uniqueness is the unique index on `(ref_prefix, ref_code)` plus generate-and-retry. At a load factor of 10^-4 the retry fires roughly five times in a hundred thousand. The unit test asserts what is actually true — fewer than 30 duplicates in 100 000 draws — and says in the test why zero would be the wrong assertion.

**The retry is injectable.** A real collision is a one-in-a-billion draw, so a test waiting for one would never see it, and untested retry logic in the path that guarantees uniqueness is where a silent bug lives. `allocate*Reference` takes an optional `generate`, production passes the real one, and the integration test forces two collisions and then a free code. Exhausting the attempts throws a message naming the likely cause — a seeded generator — rather than looping.

### 3. Crockford as specified, no house alphabet

32 symbols, `I`, `L`, `O` and `U` absent. On input `O→0` and `I`/`L`→`1`; `U` is rejected rather than mapped, because a code containing one was never issued and quietly rewriting it would resolve a typo to a stranger's contribution.

`B`/`8`, `S`/`5` and `Z`/`2` are deliberately **not** aliased. It would cost alphabet space and diverge from a standard somebody can look up, and the real mitigation for reading off a photograph is one-tap copy on the pay screen and the code set large. If field data shows people mistyping those, tighten it then with evidence.

The prefix normalises the other way — `0→O`, `1→I` — because a prefix is letters. `N0K` meant `NOK`. It costs nothing, since a prefix never contains a digit, and a prefix that is still not three letters after normalising is refused.

### 4. Unique on the pair

A banking app's reference field receives the whole string, so `MTH-4K7B2X` is what must reconcile to exactly one contribution. Uniqueness on the code alone would make the tag decorative.

`resolveReference` searches events first, then contributions, and that order is documented and tested rather than incidental.

### 5. The prefix rule does not reproduce the designs, and my restatement said it would

The rule is: letters only, uppercased, first three of the **longest** word, falling back to `UMC`.

I claimed when proposing it that this reproduces `MTH`, `AYA` and `ZAN`. **That was wrong**, and the tests now record what it actually produces:

| Title                    | Rule  | Design |
| ------------------------ | ----- | ------ |
| Nokuthula Mthembu        | `NOK` | `MTH`  |
| Baby Ayanda              | `AYA` | `AYA`  |
| Zanele's graduation      | `GRA` | `ZAN`  |
| Mthembu family gathering | `GAT` | `MTG`  |
| Lindiwe & Sipho          | `LIN` | `LND`  |
| MaZondi's stone          | `MAZ` | `MZD`  |

_Nokuthula_ is longer than _Mthembu_; _graduation_ is longer than _Zanele_. The designs were written by a person picking the name they would recognise on a statement, which no mechanical rule reproduces.

A first-word rule would match `ZAN` and `MTH` but not `AYA`. Neither is clearly better, the prefix carries no uniqueness, and the approved rule is implemented as approved — but the choice rested partly on a claim of mine that was false, so it is worth revisiting if the statement line matters more than assumed.

### 6. Every event gets a code at creation, retiring the M1-08 stopgap

`createDraft` allocates one, so an event never exists without the code its trust panel tells a contributor to type into `/check`. `events.ref_prefix` and `ref_code` are NOT NULL — a published page that cannot offer that instruction has nothing to put in place of it.

The public page now reads the real code. The "first six characters of the slug" stopgap and its comment are gone.

Existing development rows were backfilled from `md5(id)` rather than from `random()`: a volatile expression in an `UPDATE` can evaluate once for the whole statement, which would have given every event the same code and failed the unique index on the spot.

---

## M2-03 · Needs board — data and rules

### 1. The reservation is one conditional UPDATE, with a CHECK behind it

```sql
UPDATE need_items SET quantity_claimed = quantity_claimed + :q
WHERE id = :id AND status = 'active'
  AND quantity_claimed + :q <= quantity_required
```

Two people tapping "I'll bring the last chair" both run that statement; Postgres applies them in order and the second matches no row. There is no read-then-write to lose and no lock to take — the atomicity is the statement's own (CLAUDE.md rule 5).

`quantity_claimed <= quantity_required` is the backstop, in the same posture as the ledger's unique index beside its advisory lock: the mechanism can be wrong, and what catches it should be the database rather than a reviewer. Removing the guard from the UPDATE was checked — every concurrent claim then fails with `need_items_quantity_claimed_within_required`, which is the constraint refusing what the query let through. An over-claimed item is two families arriving with one tent.

The alternative considered was deriving availability from `SUM(quantity)` over active claims under a per-item advisory lock. It cannot drift, but **no CHECK can express a cross-row sum**, so it would have had no database backstop at all.

### 2. Expiry is lazy as well as swept

Claiming releases lapsed claims on the item it is about to touch, before reserving. A claim that expired an hour ago therefore never blocks somebody now, whether or not the sweep has run — and that failure would have looked like a bug in the board rather than in the schedule.

`scripts/expire-claims.ts` does the same release across everything lapsed, so the **public board** is honest between attempts: a chair that came free on Tuesday should not still look taken on Thursday because nobody happened to try for it.

Every release is conditional on the claim still being `claimed`, so overlapping runs cannot give back the same chair twice. Removing the lazy release was checked — the "does not block somebody now" test fails and nothing else does, which is the right blast radius.

The sweep prints counts only. It runs unattended and its output goes to logs (rule 8).

### 3. Seven days, as a named constant

`CLAIM_HOLD_MS`, with `CLAIM_WARNING_MS` at 48 hours to match the notification matrix (§8.2). Long enough that "I'll bring the tent" is a commitment somebody plans around, short enough that a forgotten claim does not hold a chair until the morning of the funeral. Named because real organisers will eventually say it is wrong, and that should be one edit.

### 4. `delivered` still holds its quantity

`claimed` and `delivered` hold; `expired` and `withdrawn` give back. The thing arrived — the item is no less taken for it — so confirming delivery decrements nothing.

A delivered claim also cannot be withdrawn afterwards, and an expired one cannot be confirmed: confirming a lapsed claim would silently re-reserve a quantity somebody else may already have taken.

### 5. Partial claiming is derived, never stored

Allowed exactly when `quantity_required > 1`. The designs carry a `splittable` boolean; it would always have to agree with the quantity, and two fields that must agree eventually will not — with the derived one being the one nobody updates. A tent is one tent. 20kg of meat is twenty.

### 6. `divideWithRemainder` — the M1-03 deferral, defined by its first caller

M1-03 left division out of `Money` so the first real caller would settle the shape. This is it: an item's estimated cost split across the people claiming part of it.

It returns `{ each, remainder }` and the caller places the remainder. R100 three ways is 33,33 each and one cent over, and where that cent goes is a product decision, not arithmetic. A property test over 10 000 random splits asserts `each × parts + remainder === total` exactly, and that the remainder is always smaller than the number of parts.

### 7. Three states for suggestions, and no account anywhere

`active` | `suggested` | `declined` on `need_items`, plus `suggested_by_name`. A boolean cannot distinguish "not yet looked at" from "looked at and declined", and those are different things to an organiser working down a list — the declined one should stop coming back at them.

A suggestion is invisible on the public board and cannot be claimed while it is only suggested. All we hold is the name the contributor typed: they have no account and never will (rule 4). Approving and declining are scoped to the organiser who owns the event.

### 8. Four constraints, one of which is easy to miss

`quantity_required >= 1`, `quantity_claimed >= 0`, `quantity_claimed <= quantity_required`, and `need_claims.quantity >= 1`.

The last one stops a zero-quantity claim sitting in the list looking like somebody had taken something — the chairs would appear taken for a reason nobody could find.

---

## M2-04 · Needs board — interface and claim API

### 1. One endpoint, two correct answers — and C.5's "409" is the JSON path

`POST /api/claim` negotiates on `Accept`:

- `application/json` → **`409 Conflict`** when somebody was quicker, exactly as Part C.5 specifies. This is what the page enhancement reads.
- anything else (a browser form post) → **`303 See Other`** back to `/e/<slug>?claim=…`.

The redirect is not a softening of C.5. A literal 409 with an HTML body would keep the status code and break POST-redirect-GET, and a refresh re-submitting a claim is precisely the failure that puts two tents at one funeral. **C.5's "409" describes the JSON caller**, and this entry exists so nobody later reads a divergence where there is none.

Both paths run the same reservation — M2-03's conditional UPDATE. Nothing in the route decides who wins.

### 2. ~1.5KB of enhancement, and a test that stops it becoming a dependency

`public/needs-board.js` is 1 530 bytes gzipped: no framework, no build step, no hydration. It removes the reload on a claim and runs the undo countdown. It does not implement either.

Three tests hold the line. One claims with `javaScriptEnabled: false`. One asserts the script tag **is** present and the no-JS path still works — the assertion that catches the day the board starts needing it. One asserts the file stays under 4KB, well inside the 20KB the criteria allow.

Its `fetch` failure branch calls `form.submit()`: offline or a request that never landed falls back to the thing that always works, rather than inventing an outcome.

The script is a separate file rather than inline because §10 forbids `unsafe-inline` in `script-src`.

### 3. Undo is a capability in a cookie, never in a URL

A contributor has no account (rule 4), so the right to undo cannot be an identity. The server issues an `HttpOnly` cookie holding `<claimId>.<HMAC>`; the Undo form posts the claim id and the server requires the cookie to match.

**Stateless** — the token is an HMAC of the claim id under the server pepper, so there is no column, no row to clean up, and nothing in a database dump beyond an id already there. A token that never expires is harmless because the window closes at fifteen seconds.

The item id travels in the query string and that is fine: anybody with the event link can claim, and the link is the capability. The undo token is a different thing and would leak through `Referer`, browser history, and a screenshot on a borrowed phone.

A test confirms a second browser on the same URL is offered no Undo button at all.

### 4. Undo and withdrawal stay separate

The fifteen seconds are enforced **server-side**, against `created_at` — a window that only exists in the interface is not a window. The countdown in the enhancement runs from seconds rendered by the server, not from an absolute timestamp, so a phone with a skewed clock does not eat somebody's undo.

`withdrawClaim` (M2-03) keeps no window: that is the organiser releasing something back to the board. Different act, different person. Collapsing them would let a contributor release a claim a week later.

The cookie is cleared on a successful undo, so the capability is spent rather than lingering.

### 5. `no-store` when the page is somebody's

A page saying "you've claimed the tent" belongs to one person. When the request carries a claim cookie or a `?claim` parameter the response is `no-store`; otherwise it keeps `s-maxage=60`. `Vary` now includes `cookie`.

Without this, one person's confirmation gets served from a shared cache to the next visitor — and on a page shared to fifty people that would look like the board lying about what is taken.

The browser that just claimed keeps getting `no-store` for as long as it holds the undo capability, which is correct: its board has a button nobody else's does.

### 6. Two protections on an endpoint with no session

**Same-site check.** `Sec-Fetch-Site` first — set by the browser, unforgeable by script — falling back to `Origin`, and refusing a request with neither. Without it any page anywhere could make a visitor silently hold a chair on a funeral. No money moves; that does not make it harmless.

**Per-address limit**, 20 claims an hour, reusing M1-06's hashed-address pattern and carrying the same caveat: the address is only as trustworthy as the proxy in front of it, so this is real behind Cloudflare and a speed bump anywhere else. Generous on purpose — a family behind one NAT, or a church hall on shared wifi, must not lock each other out. `need_claims.claimed_ip_hash` also gives an abuse review something to work from.

### 7. Two mutation checks

| Change                                                    | Result                                                 |
| --------------------------------------------------------- | ------------------------------------------------------ |
| Ignore the reservation's answer and always report success | The conflict tests fail — both browsers claim the tent |
| Accept any `Sec-Fetch-Site`                               | The cross-site test fails                              |

### 8. Copy that changed, and one page test that had to be rewritten deliberately

`eventCopy.needs.notYet` — _"Claiming opens shortly"_ — was true at M1-08 and is now false. Removed rather than left sitting in the copy file.

M1-08's e2e asserted the page **ships no JavaScript at all**. That assertion is now wrong, and loosening it to "some scripts are fine" would have thrown away what it was protecting. It asserts instead that the only script on the route is `/needs-board.js` — so a framework runtime coming back still fails. The size gate got the same treatment: it used to warn on any script, and now fails the build on any script that is not the enhancement.

The board and the enhancement together cost **2.1KB**: first load went from 30.8KB to 32.9KB, against a 20KB allowance and a 150KB ceiling. LCP on slow 3G is 0.61s.

---

## M2-05 · Contribution flow — Mode A

### 1. The gap M1-07 left: nothing captured how people pay the organiser

Mode A has no payment rail. The contributor pays the organiser directly, so the organiser's PayShap number **is** the payment path — and nothing in the product had ever asked for one. `events.direct_pay_details` existed in the schema and was empty everywhere.

So this task adds `/manage/[id]`, an organiser screen with two things: where to put that number, and a queue of payments to confirm. **Deliberately plain — M3-08 replaces it**, the same treatment `/account` got in M1-07.

The pay step refuses to render a payment screen without it and says so: _"This page cannot take money yet. The family has not added the number people should pay into."_ A blank where a payment number belongs is how somebody pays the wrong account, and that is not recoverable.

No verified badge beside the name. Verification is M3-01 and nothing has been checked — the same honesty fix as M1-08.

### 2. Three routes, and "bring something" is claiming

`design/contribute.html` branches at the first step, so the flow is not one path of five:

| route                  | steps                                     |
| ---------------------- | ----------------------------------------- |
| money                  | choose → amount → who → pay → done        |
| bring something        | choose → item → who → done                |
| money toward one thing | choose → item → amount → who → pay → done |

The item route has **no pay step** — nothing is being paid — and it reserves through M2-04's claim path rather than growing a second one. Two code paths reserving the same chair is how the last chair gets taken twice, and M2-03's atomicity only holds because there is exactly one reservation.

### 3. `self_reported_at` is the column the queue depends on

The row is created when the pay step is reached, because a reference code needs something to be unique against and that is the first moment one is shown. Most rows created that way are people who looked at a number and went to their banking app — or did not.

`self_reported_at` is what "I've paid" sets. Without it the organiser's confirmation queue cannot tell a payment from a glance, and that queue is the one screen where money is acknowledged.

Self-reporting is conditional on the row still being pending and unreported, so a double-tap on a slow connection reports once.

### 4. Confirmation is the only thing that writes to the ledger

The organiser checks against their own bank notification and confirms; the status change is conditional on the row still being pending, and the ledger entry follows it. Two taps produce one entry — asserted.

If they are wrong, the correction is a reversal entry (rule 3). There is no unconfirm, and the screen says so.

### 5. Limits, and the same proxy caveat for the third time

**5 self-reports per phone per hour, 20 per address.** The flow has no account by design (rule 4), so a phone and an address are the only two things there are to count. Both are generous on purpose: a family sharing one number and a church hall on shared wifi are ordinary, and locking them out to slow an attacker would cost the product the people it is for.

Same caveat as M1-06 §5 and M2-04: the address is only as trustworthy as the proxy in front of it. Every Playwright context in this suite got a fresh `cf-connecting-ip` **from the start** rather than discovering the limit under parallel load for the third time.

### 6. Fourteen days voids, and does not delete

Per §5.2. A contribution somebody reported and nobody confirmed is a thing that happened — the same reason a disputed contribution stays visible with that status rather than disappearing.

`pnpm expire:claims` became **`pnpm expire`**, sweeping both claims and stale contributions. One scheduled job for the product beats a growing collection, and one cron entry is one thing to get wrong instead of four.

### 7. Two mutation checks that both survived first time, and why

This is the part worth reading.

**Removing the pay-details guard changed nothing** the tests could see, because the page component _also_ checks for missing details and renders the honest message. Two guards, one tested. The real damage of removing the route guard is invisible on screen: it creates a contribution row and issues a reference code for a page that cannot take money, leaving the organiser a queue of payments nobody could have made. The test now asserts **no row is created**, and the mutation fails.

**Removing `selfReportedAt: { not: null }` from the queue query changed nothing**, because the mapping filtered nulls out again in code. The query was the mechanism and the mapping was a redundant copy of it — so the mechanism's removal was silent. The mapping now maps, the query decides, and the mutation fails.

Both were the same mistake: a guard duplicated in two layers is a guard whose removal no test notices. Defence in depth is worth having where the layers are genuinely different — the ledger's advisory lock and its unique index, the claim's conditional update and its CHECK — because there the second layer is the database and can be observed failing. Two application-level checks of the same condition are just one check with a spare.

### 8. Everything is a route handler, and no account anywhere

The contribution path is what a stranger walks on a prepaid bundle, so an App Router page here would undo M1-08 on the exact route it was built for. First load is **33.2KB**, LCP 0.56s.

State moves between steps in hidden fields — nothing to expire, nothing to clean up, the back button works.

An E2E test walks every step collecting the type, name, id, placeholder, autocomplete and text of every control, and asserts none of it contains `password`, `email`, `sign up`, `signup`, `register` or `create an account`, with zero `input[type=password]` and zero `input[type=email]`. A phone number is asked for and marked optional; an email address is never asked for at all, because it is the field that turns into an account.

The amount placeholder is `R1 234,56` from the first render, per M1-03: `parseMoney` refuses `1,234` as ambiguous rather than guessing, and showing the shape means most people never meet that refusal.

---

## M2-06 · The Ledger Strand

### 1. In-kind had no ledger entry, and now it does — scope taken deliberately

Found while looking for the strand's data source: **nothing in the product had ever written an in-kind contribution.** `confirmDelivery` marked a claim `delivered` and stopped there — no contribution row, no ledger entry. Cash was recorded and provisions were not, on a platform named for _ukupheka_.

That also left M2-01's strengthening decorative. The hash was extended to cover `in_kind_description` precisely so _"the tent"_ could not be edited to _"a chair"_, and the column had no rows in it.

So `confirmDelivery` now does three writes in one transaction: the claim becomes `delivered`, an `in_kind` contribution is created for it, and the ledger entry is appended. Any two of those without the third is the record saying something that did not happen — a delivered claim nobody is credited for, or a bead for a thing that never arrived. `appendEntryWithin` was extracted from `appendEntry` so the append can join a transaction the caller already opened; the advisory lock moves with it, so the serialisation guarantee is unchanged.

**This is scope beyond "render beads", agreed before it was written.** A funeral strand showing only money inverts the meaning of the word the product is named after.

Two consequences worth naming:

- **`/manage/[id]` grew a third card** — "Things people are bringing", with a confirm button per claim. Without it the new path had no caller: nothing in the interface could confirm a delivery, so no in-kind bead could ever appear. Still the plain stub M3-08 replaces.
- **The claim form now says what happens to the name.** _"Your name goes on the strand once the family confirms it arrived."_ Publishing somebody's name on a page fifty people have, when all they were asked for was "Your name", is not a thing to do quietly.

The description written to the chain is the label, with the quantity when there is more than one: `Chairs × 100`. "Chairs" and "Chairs × 100" are different acts and the hash covers the difference.

### 2. Uniform bead diameters where amounts are hidden — a correction to Part C.4

C.4 said four diameters by band, everywhere. On a bereavement page that is wrong, and the spec has been corrected rather than worked around.

Amounts on those events default to hidden (§7.3). Four monotonic diameters give a coarse amount straight back: anybody who compares two beads learns who gave more, permanently, in public, on the page the family shared with everyone they know. That is the comparison the hidden default exists to prevent.

So bands apply where `amountsPublic` is true and every bead is 14px where it is false. **It reads the config flag that already sets the visibility default**, so the two cannot disagree, and nothing anywhere asks whether this is a funeral (rule 2). `design/event.html` bands its funeral variant — a prototype bug of the same class as the accent literal M1-04 found.

Thresholds, agreed: `< R100 / < R500 / < R2 000 / ≥ R2 000` → 10/14/18/24px. Pure in-kind takes 14px uniformly: it has no amount to band, and reading smaller than cash would break the equal-mass rule that makes the two forms peers.

### 3. Beads are submit buttons in a GET form, not `<details>`

C.4 asks for a real `<button>`. The public page ships no framework (M1-08), so opening a bead had to work with no script.

`<details>`/`<summary>` was the alternative and costs no request at all. It was not taken: a `<summary>` is not a `<button>` however well it behaves, and everything else on this page is a server round-trip already — claiming, undo, contributing. One posture for the page beats a second mechanism that happens to be cheaper on one interaction.

So the strand is one `<form method="get" action="/e/<slug>#strand">` and each bead is `<button type="submit" name="bead" value="<id>">`. The server renders the open panel. The fragment on the action survives form submission, so the reader comes back to the strand rather than the top of a page they have already read.

**The cost is real: tapping a bead reloads the page.** ~7KB compressed, measured. If field data shows bead-tapping is common, `public/needs-board.js` can intercept it without the markup changing — which is the reason the markup is shaped this way rather than around a script.

The open bead's own button carries `value=""`, so it closes itself and nothing needs a toggle.

### 4. Geometry as two custom properties, and what that buys

Each bead carries `--d` (its diameter) and, when braided, `--x` and `--y`. Everything else — the forms, the cords, the hit area, the motion — is in the stylesheet.

Measured on the production build: the strand at 200 contributions costs **4.6KB transferred**, against the 15KB the criteria allow. The page went from 32.9KB to 34.6KB first load with an _empty_ strand (the CSS and the intro), and LCP on slow 3G is 0.62s. `pnpm gate:size` now measures the strand separately and fails the build over 15KB.

The gate's strand fixture is **created once and never deleted**: `ledger_entries` refuses the delete by foreign key and the application role holds no DELETE on the table at all. The append-only guarantee met by a size gate rather than by an attacker.

### 5. The strand is read from the ledger, not from `contributions`

`strandForEvent` reads `ledger_entries` where `entry_type = 'contribution'`, ordered by `sequence_no`, and drops any entry a `reversal` points at.

Reading the contributions table would have been simpler and would have produced a second opinion about what happened — one that could disagree with the incwadi while both looked right. The chain is the record (rule 3), so the picture is the same thing rendered twice.

Sequence rather than `created_at`, because the order the chain was written in is the order people came and is the only order that cannot be ambiguous.

`anonymous` withholds the name and keeps the bead and the words. `name_only` shows the name — it hides the amount, and the strand shows no amount for anybody.

### 6. One check for motion, not two

The newest bead settles, and only where `isAnimated(archetype)` — the type layer of architecture §6, which tests `animate === true` explicitly, so an archetype that merely failed to declare the flag gets nothing.

`mayRender(archetype, 'motion')` is deliberately **not** called beside it. It throws in development on a violation, which is right for a component that has no business animating at all, and wrong here: this component decides whether to animate rather than assuming it may. Two application-level checks of one condition is one check with a spare, and neither one's removal would be noticed — docs/decisions.md M2-05 §7.

`prefers-reduced-motion` in `tokens.css` already turns it off globally for anybody who asked.

### 7. Two things from the prototype that are not shipped

**The multi-cord `aria-label`** — _"40 people have contributed to this ceremony"_. That is a count, which C.4 forbids on the page; putting it in an accessible name gives it to screen-reader users and nobody else. The strand is a real `<ul>` at every density instead, so the same information — who, and what they brought — arrives as a list.

**The two `strandNote` lines** — _"The strand doubles once it passes thirty…"_ and _"Beyond two hundred the strand braids across five cords…"_. Both announce which density band the page is in, which is a count in words. The prototype's version also only has two notes for four bands, so the three-cord case reads the wrong one.

**Also not built: the "Read the incwadi" list** below the strand. At 400 people it is a list of 400 names, which doubles the markup against a 15KB allowance and is a count in another form. The strand carries the names already — beside the bead up to thirty, in the accessible label beyond it.

### 8. Hit areas overlap at the densest band, by construction

C.4 asks for a 44px hit area with the bead staying small. At five cords the pitch is 18px, so adjacent buttons overlap and the later one in source order wins in the middle.

Not fixed, and worth knowing rather than discovering: the strand is the picture, and a specific person is reached by tapping near their bead. Shrinking the hit area to remove the overlap would trade a real accessibility floor for a tidier diagram.

### 9. `PublicEvent` grew an `id`

The chain is keyed by event id and the page had only the slug. It is server-side only and never rendered — the slug remains the capability.

---

## M2-07 · WhatsApp share + OG images

### 1. `next/og` ships with Next, and Satori cannot read our font

`ImageResponse` is compiled into Next 16 (`next/dist/compiled/@vercel/og`), so the card costs no new dependency. What it did cost is **two font binaries**, because Satori reads `ttf`, `otf` and `woff` and **not** `woff2` — which is the only format the page ships.

So `src/assets/fonts/public-sans-latin-{400,800}.woff` are committed, 18KB each, hash-pinned by a test the same way M1-05 pinned the woff2 pair. They live in `src/assets/` rather than `public/` on purpose: no browser ever downloads them, no route serves them, and M1-05's "exactly two woff2 files ship" test stays true rather than being loosened. An e2e test asks the server for them and expects 404.

They are read from disk per process and held. `next.config.ts` names them in `outputFileTracingIncludes`, because standalone output traces imports and not `readFile` paths — without it the card renders as boxes in a container that passed every test on a machine where `src/` happened to exist.

### 2. The image URL is a content hash, and that is the cache

`/e/<slug>/og/<version>.png`, where the version is 16 hex characters of SHA-256 over everything the card draws — title, subtitle, organiser name, archetype, kicker, place, date, and whether the badge is on.

It does two jobs with one mechanism:

**It is the cache key.** Same facts, same key, one generation ever. The object store is asked first and only a miss draws anything.

**It is how WhatsApp is told to look again.** WhatsApp caches a preview against the URL it fetched and revisits on nobody's schedule but its own. A changed title mints a new URL, so the next person to receive the link sees the current card rather than the one from before the family fixed the spelling of their mother's name. That is §9.1's "regenerate on material change only", falling out of the key rather than being a job somebody has to remember to run.

**A stale version still gets a card.** A link already sitting in a chat holds the old URL, and answering it with a 404 would turn a preview somebody already sent into a broken box. It is served the current card with `max-age=60`; only the current URL gets `immutable` and a year.

### 3. `ObjectStore`, with local disk behind it and no provider chosen

Declared in `src/domain/storage/`, implemented in `src/adapters/storage/` — the same inversion as `PaymentProvider` and `SmsSender`. Three methods: `get`, `put`, `has`. Nothing deletes, because everything stored is content-addressed and the only reason to remove a key is housekeeping.

**No storage provider has been chosen** (architecture §3 wants S3-compatible in `af-south-1`; §15 item 6 has not picked a region). `LocalObjectStore` writes under `.cache/objects/`, gitignored.

The cost, stated rather than hidden: **on more than one instance this caches per instance.** That is acceptable here and would not be for something correctness-depended on — the URL is immutable and sits behind Cloudflare, so the origin cache saves a redraw rather than a wrong answer. It logs once in production so the day this reaches a real deployment somebody sees it.

Two things the local implementation does that a naive one would not: it refuses a key that could escape its root (checked in the domain and again after `resolve`), and it writes to a scratch name and renames into place, so two requests racing a cold card cannot leave a reader half a PNG — which WhatsApp would then cache for as long as it liked.

### 4. Nothing on the card can be added up

No amount, no count, no target, no progress. The meta line is kind · date · place.

The strand hides amounts on a bereavement page because comparing what people gave is the thing to prevent (§7.3). **A card travels further than the page it came from** — forwarded, screenshotted, sitting in group chats belonging to people who never opened anything — so a total on it is that same privacy problem exported to a surface we have no control over at all. A unit test asserts the absence across every archetype.

### 5. The badge slot exists and draws nothing

`verified` is a prop, it is `false`, and `cardFacts` sets it as a constant rather than a defaulted parameter — a default is something a caller can pass the other way by accident, and there is no honest way to pass `true` today.

The prototype's share copy said _"Every person who opens it sees your verified name."_ Not shipped: an organiser reads that while deciding whether to send the link to fifty people. What ships says what the card does carry, and a panel says plainly that the check is not switched on yet and will appear here and on the card when it is. Same class as the two strings refused in M1-08 §5.

It is in the version hash, so the day M3-02 turns it on, every card already sitting in a chat stops being the current one.

### 6. Satori has no cascade, so the accent fallback is applied once in code

`var(--accent, #16233D)` is a CSS mechanism and there is no CSS engine here. `cardAccent(archetype)` returns `archetype.accent ?? '#16233d'` — one function, reached by the _absence_ of a value rather than by a conditional on the group, which is what rule 2 is actually about. A test asserts every archetype's card contains only the palette plus that archetype's own accent.

### 7. The card is centred, because WhatsApp crops thumbnails from the middle

The large preview shows the whole 1200×630. The small one crops toward a square, and anything set against the left edge is the first thing to disappear — including the name, which is the thing carrying the card. Centring costs nothing at full size and is the difference between a legible thumbnail and a picture of the letter N.

Long titles are cut in code with a character budget rather than left to the renderer: Satori's overflow is not a browser's, and a title that overflowed would be found in somebody's chat rather than in review.

### 8. `<noscript>` hides the copy button, and two attempts before it were wrong

The share step's WhatsApp and SMS buttons are plain `<a>` links — `wa.me/?text=` and `sms:?body=` — and need no script at all.

Copy-to-clipboard does. Three approaches, and the first two are recorded because they both looked right:

- **Server-render it hidden, unhide from script.** React rendered `hidden`, the script removed it, and hydration reported a mismatch on every load.
- **Render an empty slot and inject the button.** Same mismatch one level down — React diffs `dangerouslySetInnerHTML` content too.
- **Render the real button and put `<noscript><style>[data-copy-button]{display:none}</style></noscript>` beside it.** `<noscript>` is parsed only when scripting is off, so the button is hidden exactly where it could not work, nothing mutates the DOM, and what React rendered is what it hydrates.

**This is the second vanilla enhancement, and deliberately not the first client component.** A `'use client'` boundary for a copy button would be an expensive precedent for a small convenience.

### 9. Three more things the copy button turned up, none of them obvious

The 700 bytes cost more time than the card did, and all three findings are about App Router behaviour rather than about clipboards.

**A `<script src>` rendered by a client-side transition does not run.** Publishing redirects into the share step as an App Router navigation, and on that path the tag was simply absent from the document — the button was dead for the organiser, and alive for anybody who happened to reload. Found by a test that passed only when it reloaded first. It is now `next/script` in `src/app/(organiser)/layout.tsx`, loaded once for that whole section.

**The listener is delegated to the document.** React hydrates this page after the script runs and may replace the nodes it hydrates; a listener bound to the button found at load time then sits on a node that is no longer in the document, and the button does nothing with no error anywhere. Delegation does not care which node instance exists.

**`execCommand` is tried before `navigator.clipboard`, and that is not nostalgia.** The modern API needs a secure context, a permission and a focused document; where any of those is missing its promise can never settle at all. `execCommand` runs synchronously inside the click, keeps the user activation the browser requires, and works in an old Android WebView — which is a phone this product expects to meet. The label changes only when a copy actually succeeded.

The e2e asserts the **selection**, not the clipboard: both copy paths need a focused document, and a headless Chromium sharing a machine with five other workers frequently is not focused, so asserting the clipboard would be testing the runner's window management. The selection proves the handler ran on the right element and got as far as asking. That the copy itself works is on the device checklist below.

### 10. The chat preview is a mock, and it keeps WhatsApp's surface but not its contrast

The organiser is shown how their name reads at the size their relatives will see. It is drawn in markup rather than by embedding the PNG: fetching 53KB to demonstrate legibility is beside the point, and the mock reads the same copy and the same meta line as the card, so the two cannot say different things.

WhatsApp draws its own caption line at `#7a8474`, which is 3.24:1 on its bubble and an axe failure. The mock uses `#525c4a` — 5.8:1. The point of the mock is that it is read.

### 11. English, and no language column

M2-07 asked for the message "in the organiser's language". There is no locale on an organiser or an event, and no isiZulu copy anywhere: `src/copy/` is the translation unit Part D describes, with one language in it.

The message is keyed by archetype in `src/copy/share.ts` and written in English. Bereavement gets its own — _"This is for … What the family still needs is on here, and who has stood with them"_ — because you do not send "who has helped already" about a funeral.

**No language column was stubbed.** An unused column is an invitation to populate it badly, and the locale should arrive with the translations rather than ahead of them. The plan's criterion now says English at launch, and Part D carries the dependency.

### 12. What is measured, and what is still open

Automated: the tags exist and are absolute; the image is a 1200×630 PNG well under WhatsApp's size limit; the card is generated once — proved by overwriting the cached bytes with a marker and asking again, so a route that regenerated would fail; a changed title mints a new URL and the old one still answers without `immutable`; a draft has no card; the two Satori faces are served to nobody. First load of the public page went from 34.6KB to 34.8KB — the tags — against the 150KB ceiling.

**Still open: "preview renders correctly in WhatsApp on iOS and Android."** WhatsApp's crawler fetches from the internet and cannot reach a development server, so this needs a public URL and two real phones. It is not marked met.

**The device checklist, for whoever has the phones:**

1. Deploy to a publicly reachable host and publish a test event of each kind — one bereavement, one union.
2. Send the link to yourself in a WhatsApp chat on **iOS**, and again on **Android**. Confirm the card renders rather than a bare URL, that the title and the organiser's name are legible, and that no tick appears.
3. Reply to that message so it appears as a quoted preview, and check the **small thumbnail**: bead colour and name should survive the crop.
4. Confirm the funeral card is indigo and carries no accent, and that neither card shows an amount or a count.
5. Change the event's title, send the link again in a **new** chat, and confirm the new card appears — WhatsApp caches by URL, so this is the check that the version mechanism works in the wild.
6. Send the link in a group of 10+ people and confirm the preview renders for recipients, not only for the sender.
7. Check the same link in Signal and in an SMS on both platforms — SMS shows no preview at all, which is expected, and the message must still read sensibly with the URL at the end.

Anything that fails there is a task, not a tweak: record it here and fix it before M3 puts a badge on the same card.

---

## M2-08 · Notifications

### 1. An outbox and a cron, not Redis — read this with M1-06 §4

Architecture §3 lists Redis + BullMQ. Neither is installed, and this task did not install them. **Read this entry and M1-06 §4 as one decision rather than two drifts:** that one declined Redis for rate limiting because a counter can be read transactionally from a table we already write, and this one declines it for the same reason, one layer up.

What a digest needs is state that survives a restart and a row two writers can race for. Postgres gives both transactionally. What it does not give is a scheduler, so `pnpm notify` runs hourly beside `pnpm expire`.

Two tables:

- **`notifications`** — a message we intend to send.
- **`digest_entries`** — a thing that happened, waiting for a summary.

One table with a mode column would be one row type pretending to be two, and every query would immediately have to say which kind it meant.

**What makes this reversible:** BullMQ can replace `flushNotifications` as the _runner_ without touching either table. The rule lives in the schema and in `src/domain/messaging/notification.ts`, not in the thing that calls them. If the queue arrives, the outbox becomes what it already is on every serious system — the durable record behind the queue.

### 2. The done-criterion is a property of the data, not of a counter

Fifty contributions in ten minutes produce exactly one message, and it is three facts rather than a count somebody maintains:

1. Every fact is a `digest_entries` row with `notification_id` null.
2. Building a digest claims **all** of them in one `updateMany`.
3. The next digest cannot be built until an hour after the last, and not outside the send window.

The integration test runs the flush three times inside the ten minutes to prove the cap is the constraint and not the schedule, and asserts that no entry is left unclaimed — a digest that sent one message while leaving forty-nine facts pending would satisfy a naive reading of the criterion and be wrong.

Overlapping cron runs take an advisory lock on the pair, the same mechanism as the ledger (M2-01 §5). Removing it was not left to discipline: a test races two `buildDigest` calls and expects one digest.

The hour is measured from when a digest was **created**, not from when it was delivered. A BSP outage must not turn into fifty messages the moment it clears.

### 3. Quiet hours, 07:00–21:00 SAST

Not in the task, agreed before writing, and worth stating plainly: a phone buzzing at three in the morning about contributions to your mother's funeral is a harm we would have shipped without noticing. A digest is non-urgent by construction, so holding it costs nothing.

**The build is held, not the send.** A digest built at 03:00 and scheduled for 07:00 would summarise the night and miss whatever happened at dawn; holding the build means one message in the morning covering all of it. The test asserts exactly that: somebody contributes at 03:00 and somebody else at 06:59, and one message goes at 07:00 saying two people.

Immediate messages are unaffected. Somebody who has just been told their contribution is confirmed is waiting for it.

South Africa is UTC+2 with no daylight saving, so the conversion is arithmetic rather than a timezone database.

### 4. Per organiser per umcimbi

"Max one per hour to the organiser" is ambiguous for somebody running two imicimbi. A digest mixing a wedding and a funeral into one message is the worst possible output of a batching rule, so the cap is per pair. The cost is a third message an hour to somebody running three events, which is trivial against the alternative.

### 5. Email is not a fallback for contributors, and that is the answer

§8.2 says email backs every row. It was written before rule 4 was as firm as it is. A contributor has no account and is never asked for an email — M2-05 has a test asserting no email input exists anywhere in the flow — so where there is no phone number there is nothing to fall back to.

`channelFor` returns null, `enqueueNotification` returns null, and nothing is sent. **Some contributors are not notified.** The alternative is collecting addresses to buy a fallback, which spends the property to fix the symptom.

The fallback is real for organisers: three failed attempts on WhatsApp produce the same message by email if we hold an address. A test proves it fires for an organiser and does not for a contributor.

### 6. Templates are data, and the category is the expensive part

`src/domain/messaging/templates.ts` holds what Meta needs — registered name, language, category, ordered parameters — and **no words**. The words are copy (rule 11) in `src/copy/notifications.ts`, keyed by archetype where the register differs: a funeral digest does not say "helped", and the confirmation to a contributor says "your name is on the record of who stood with them" rather than "your bead is on the strand".

`TemplateCategory` is the literal type `'utility'`. Declaring a marketing template requires editing that line, which is the point.

The test does two things the type cannot. It scans every string for the vocabulary that gets a template **reclassified** — "click here", "free", "limited time", "don't miss" — because reclassification happens to the template rather than to the message, so one careless sentence re-rates every message that template will ever send. And it asserts no amount, total or target appears in any of them: a notification is read on a lock screen and forwarded without thinking, and on a bereavement event amounts are hidden by default (§7.3).

`confirmation` is a template _parameter_ rather than fixed body text, so the archetype register can change without two registered templates having to be kept in step inside somebody else's console.

### 7. The cost model, at post-1-October-2026 rates

Architecture §8.1: from 1 October 2026 utility messages inside the 24-hour window stop being free. Every message this product sends is a business-initiated template, so all of them are billable from that date. The arithmetic that justifies the digest, on a 200-contribution funeral over a week:

| Design                     | Organiser messages                    | Contributor messages |
| -------------------------- | ------------------------------------- | -------------------- |
| One per contribution       | 200                                   | 200                  |
| Digest, cap of one an hour | ≤ 24 a day, and in practice far fewer | 200                  |

The contributor side is not batched and should not be: those are one message to one person about their own contribution, and they are the messages that make the record feel real. The organiser side is where a funeral would otherwise generate two hundred identical interruptions on the worst week of somebody's life — the cost argument and the humane argument point the same way, which is usually the sign of a correct default.

Utility rates are a fraction of the ~$0.086 (~R1.50) marketing rate, and OTP stays on SMS because South Africa sits on Meta's authentication-international tier (§8.1, and M1-06 already).

### 8. M1-06's WhatsApp scan had to be narrowed, and it now says something sharper

`tests/unit/auth-no-code-in-logs.test.ts` asserted that **no file under `domain/messaging` or `adapters/messaging` contains the word "whatsapp"**. That was a fine proxy while messaging meant SMS; the moment notifications landed in the same directories it would have failed for a correct change, which is how a good test gets loosened into a bad one.

Narrowed to the files a one-time code actually passes through, plus a second assertion that the sign-in action reaches for `smsSender` and neither of the other two. Both were checked by pointing the sign-in action at WhatsApp: both fail.

### 9. Retries, and what an error code may say

Three attempts — one minute, five, twenty-five — then failure and the email fallback. Not aggressive on purpose: a BSP that is down is not helped by a retry storm, and none of these messages is worth less twenty-five minutes later.

`last_error_code` holds a code and never a provider's message. Provider errors routinely quote the destination number, and this column is read in logs and dashboards (rule 8).

`markSent` is conditional on the row still being pending, so two overlapping flushes hand one message to the BSP once. Asserted by racing them.

### 10. Retention, and the one table in this schema that may be deleted from

`notifications` and `digest_entries` are the **only** tables granted DELETE. They hold a name and a phone number in their parameters and have no evidential value once the message has gone (architecture §11). `pnpm expire` prunes them after thirty days — long enough to answer "were they told?" during the umcimbi itself.

The ledger and the audit log still hold no DELETE and must not. The grant is written out by name in the migration so a reviewer sees which tables it applies to and why.

### 11. Two mechanical things worth knowing

**`src/lib/notify.ts` cannot import `src/lib/env.ts`.** The env module uses a TypeScript parameter property, which Node's strip-only mode refuses, and `scripts/notify.ts` runs under exactly that. The flush takes the app URL as an option instead, defaulting to the same value env.ts documents.

**The adapters and `src/copy/notifications.ts` now use relative imports with explicit extensions**, like the repositories, for the reason M2-01 §8 records: a script loading them resolves no tsconfig aliases. `ARCHETYPES` is imported straight from `archetypes.ts` rather than through the barrel, because the barrel re-exports values without extensions.

### 12. What is built and what is not

Built and tested: the templates, the two tables, the digest rule, the quiet window, the retry and fallback, the enqueue points on self-report, confirmation, claiming and the two-day warning, and the flush.

Not built: **delivery**. No BSP, no SMS provider and no email provider has been chosen, so all three factories throw in production rather than handing messages to an in-memory array. `pnpm notify` therefore stops on its first run in an unconfigured production, loudly — and the outbox keeps every message, so nothing is lost by that refusal. That is the whole reason the outbox exists rather than sending inline.

Also not built: the three payout rows of §8.2, deliberately. See the plan's M2-08 note.

---

## M2-09 · Collections — data and rules

### 1. The schema was already there; this task is the rules

M1-02 shipped `collections`, `collection_members`, `ledger_entry_type = 'collection'`, `contributions.collection_id`, the archetype/group CHECK and the grants — Part D2.8 said "do these in M1-02", and it was done. So this task added one column and otherwise built domain rules, a repository, and the strand's missing data source.

Part D2.8 now says so, rather than reading like outstanding work.

### 2. One column beyond D2.8: `need_claims.collection_id`

A group claim reserves through **the same conditional UPDATE every other claim uses** (M2-03 §1). A second reservation path is how one tent gets promised to two families, and no amount of care in a new code path buys back the property that exactly one statement decides who got it.

What a claim row could not say was _who_, when the who is a group. Without the link there is also no way to release an item when a collection is abandoned, and no way to tell a real group claim from somebody typing "The Ngcobo cousins" into the board. `claimant_name` stays filled, because it is what the board displays.

Unique: a collection claims one item, as a unit. Two would be two groups' worth of reservation held by one group.

### 3. A group claim does not expire

Every other claim lapses after seven days, because an anonymous claimant can vanish silently and the family needs the chair back. A collection has a named organiser, a page, and members on it — **what replaces the timer is that she is visible.**

So `expires_at` is null for a group claim, `releaseLapsed` never touches it (it only looks at rows with a date in the past), and what gives the item back is abandoning the collection. That is a deliberate asymmetry rather than an oversight, and it is asserted both ways.

### 4. One chain, never two — and the expectation that says otherwise

An attached collection's ledger entry goes on the **host event's chain**. A standalone one goes on its own. Never both.

**A reasonable person will expect an attached collection to keep its own chain as well**, and this entry exists so that when they act on that expectation they find the reasoning first. Two chains would be two records of one act. The ledger's entire claim is that there is one record and that it cannot be quietly changed; a second chain holding the same handover would make "which one is the record?" a real question, and the answer would depend on which page you were looking at.

`chainFor` is the one place that decides, and a test asserts it never returns both keys.

The consequence for reads: an attached entry carries the host event id in `event_id`, so the collection it is _about_ is reached through `reference_id`. Reading `collection_id` instead renders the cousins as a cash bead — which is how this was found.

### 5. The entry is written at handover, not at close

A collection that closed at R5 000 and never reached anybody has not given the family R5 000. A host's page showing that money would be lying in the most damaging way this product has available, because the whole claim of the page is that it shows what actually arrived.

So `confirmHandover` is the only thing that writes a collection to the ledger. It is conditional on `handover_status = 'not_started'`, so two people confirming at once produce one entry — asserted by racing them.

M2-11 owns the handover _experience_: witness confirmation, the evidence photo, the optional one-tap host acknowledgement. What is here is the rule and the append underneath it. The host does nothing in the system either way (rule 15).

### 6. What the one entry carries, and what it does not

Cash: the sum of **confirmed** members. Somebody who said they would put in R200 and has not is not on the record — putting them there would be the record claiming money that has not moved.

In-kind: `"The Ngcobo cousins — Tent"`. Specific, memorable and reciprocable in a way that "R5 000" is not (Part D2.5), and it is hashed into the chain (M2-01 §1), so it is part of the trust artefact rather than a label. A group that both claimed an item and put cash in gets both on the one entry.

**No member's amount reaches the host page at all.** The bead opens to names, not to a breakdown: the host learns that the cousins stood with them, not who among the cousins gave least. A member who joined quietly is counted and not named — `memberCount` is separate from `members` for exactly that reason, and the bead would otherwise say "5 together" while naming six.

### 7. `organiser_bank_hint` stays free text, and that is a constraint rather than a limitation

_"Nomsa's Capitec, ending 4471"_ is how members know where to send money. The moment it becomes an account we can verify or pay into, **rule 12 is gone and the regulatory position goes with it** — we would be accepting money for on-payment to a third person, which is the exact question architecture §0.2 leaves open for Mode B and which collections currently avoid entirely.

The tripwire test now checks the code as well as the schema: a repository function called `payOutCollection` would pass every structural check while being precisely what rule 12 forbids. Verified by adding one and watching the test fail.

### 8. Nothing can be shared, and no flag exists to change that

`canShare` requires `idVerificationStatus === 'verified'`. M3-01 sets it; M3-01 does not exist. So every collection created today is unshareable — which is rule 13 working, not a gap.

With a host we can withhold a payout. With a collection she has the money before we could object, so the absence of a link is **the only leverage that exists**, and it is real: a collection that cannot be shared cannot ask anybody for anything.

Tests set the status directly to exercise the shared path. The plan's M2-10 note now warns that there is no demoable share path until M3-02, so nobody arrives at that task and adds a bypass to get a screen working.

### 9. Members are `pending` until the organiser says the money arrived

She is the one who knows. A member who joined and never paid is in the group and not in the total, which keeps the ledger entry honest without asking anybody to prove a bank transfer to us — something we could not verify and have no business seeing.

Withdrawn members are neither counted nor named.

---

## M2-10 · Collection page and joining

### 1. The custody sentence is the screen's job, and it is verbatim

_"Nomsa Mthembu holds this money, not Isipheko. It goes into her own account and she hands it over on the day… You are trusting her, the way you would if she collected it in an envelope."_

Straight from `design/collection.html`, in her name, directly under the header — **above anything that asks anybody to give**, which a test asserts by index rather than by eye. Rule 16 and Part D2.6.

The trust panel keeps the design's structure too, because it answers two questions that people actually ask separately: _is this real_ and _who holds the money_. The second answer is the one that matters here — _"Isipheko never receives it, never holds it, and cannot refund it. If she does not hand it over, that is a matter between her and you."_

A test scans every rendered string for the words that would soften it: "we hold", "held safely", "protected", "guarantee", "escrow", "we refund". The failure mode this guards is somebody later making the page sound reassuring, which on this screen means making it untrue.

### 2. Amounts on the group's page, never on the host's

M2-09 made "no breakdown on the host page" a rule: the bead opens to names, and the host learns that the cousins stood with them rather than who among the cousins gave least.

This page is the other side of that. **The roster carries every member's amount**, because the eight of them know each other and the total has to add up for the people who put it there. A quiet member is _quiet from the wider world, not from the group_ — their name is withheld and their amount stays in the list, since hiding both would make the group's own total unauditable to the group itself.

### 3. The total counts what reached her; the roster lists everybody

They differ, visibly, and the page says which: a member the organiser has not marked off is listed with _"Not marked off yet"_, and the note under the total reads _"4 people · 3 marked off so far"_.

The alternative — omitting unconfirmed members — was rejected because somebody who has just joined would look for their name, not find it, and reasonably conclude the join failed.

### 4. What could not be built: the shortfall line

The design computes _"The tent costs R1 200 and we have R900. Still R300 short — nothing is handed over until it is covered."_

That needs an item's cost as a number. M1-07 §3 deliberately stores the organiser's free text instead, because _"Around R1 200 to hire"_ and _"Mealie meal, rice, sugar, oil"_ are the same field, and parsing the second into "1 unit" is data loss that reads like data.

So the page shows the running total and the claimed item by name, and no gap. **Telling a group they are R300 short when they are not is the failure that parsing prose would buy**, on a page whose whole subject is money. A test asserts the only amounts rendered are the total and one per member — an item cost would be a fifth.

This is buildable the day need items carry a real cost. That is a separate decision with its own cost: somebody has to be asked for a number at setup, on a screen that currently accepts a sentence.

### 5. The verified line is true or absent, never softened

_"Held by Nomsa Mthembu · ID verified 12 July"_ when `idVerifiedAt` is set; _"Held by Nomsa Mthembu"_ when it is not. No "verification coming soon", which is the same call M1-08 §5 made about the event page.

The framing that makes this simple: **any page a real person can reach implies a verified organiser**, because that is what the share gate means. A collection has no slug until somebody passed it.

### 6. Joining is the contribution flow's shape and none of its money

Three steps — amount, who, where to send it — as form posts with state in hidden fields. No account, no login, no email input anywhere (rule 4), asserted on every rendered step by the same kind of test M2-05 has.

**There is no payment step because there is no payment rail.** The last screen shows her bank hint in her own words, says _"Isipheko does not take it and cannot pass it on for you"_, and the button says "I've sent it" — a claim about the world rather than an instruction to us. When she has not said where to send it, the screen refuses to point anywhere: a blank where a payment destination belongs is how somebody pays the wrong person (M2-05 §1).

A member arrives `pending`. She is the one who knows whether the money reached her.

### 7. `must-revalidate` on the collection page, unlike the event page

The event page serves happily stale (M1-08): a contribution more or less does not change what a reader came for.

A roster does. Somebody who has just joined and is shown a copy without their own name on it reads that as the join having failed — so this page is `public, max-age=0, must-revalidate, s-maxage=30`. The CDN still absorbs a WhatsApp group opening the link at once; the browser does not serve its own stale copy.

### 8. `/c/[slug]` is on the performance gate

A route handler with inlined critical CSS, no framework runtime, and no enhancement script at all. Measured: **31.6KB first load** (5.4KB of HTML plus the latin font) against the 150KB ceiling, and the gate fails the build over it.

The gate's fixture verifies its organiser and sets a slug directly, because that is the only way a collection has one and no application path sets it. A fixture script setting fixture state is not a bypass in the product — the same door the tests use.

### 9. `contributions.collection_id` is unused, by design

Part D2.8 adds it, and M2-10 does not write it. **Joining writes a `collection_members` row and nothing else**, for the reason M2-09 gave a collection one chain and not two: a member's contribution recorded in both tables would be two records of one act, and the roster is what the single ledger entry is computed from.

What would have to change for the column to be needed: a member paying _through_ the product rather than to the organiser — which is Mode B and rule 12's opposite — or a contribution that belongs to a collection _and_ stands alone on the host's page, which rule 14 forbids. If somebody finds a use for it, that use is very likely a mistake.

### 10. The organiser's screen refuses, in words

She can start a collection, watch people join, mark money off, and ask for the link. The link request calls `shareCollection`, which returns `not-verified` for everybody, and the screen says _"This cannot be shared yet… That check is not switched on yet, and this page will say so until it is."_

The button is not hidden. Hiding it would leave somebody guessing what they had done wrong; the honest thing is to let them ask and to answer plainly.

**No flag bypasses this.** The tests and the size-gate fixture set the verification status directly in the database, which is state-setting rather than a door in the application. The plan says so against M2-10 as well, because that is the task where somebody wants a screen to demo.

---

## M2-11 · Handover

### 1. A capability in a URL — and why M2-04 §3 still stands

M2-04 §3 says a capability belongs in an `HttpOnly` cookie and **never** in a URL, because a URL leaks through `Referer`, browser history and a screenshot on a borrowed phone. **That decision is not reversed here.** Read the two together:

|                          | Undo (M2-04)                           | Witness link (M2-11)                 |
| ------------------------ | -------------------------------------- | ------------------------------------ |
| Who holds it             | the person already looking at the page | somebody else, on their own phone    |
| Can a cookie reach them? | yes                                    | **no — nothing about them is known** |
| Window                   | 15 seconds                             | up to 30 days                        |
| What it does             | releases a claim                       | closes a record                      |
| What it moves            | nothing                                | nothing (rule 12)                    |

A witness link has to travel. There is no cookie that can be set on a phone we have never seen, and asking the witness to authenticate would give a contributor an account (rule 4) to confirm one tap.

So the URL carries a capability, and four things bound it: **single use** — spending it is a conditional `UPDATE` on `redeemed_at`, so a link forwarded into a group chat confirms nothing twice; **expiring** at thirty days; **scoped** to one collection and one member; and it **confirms a handover and nothing else** — no money moves, and it reveals nothing the collection page does not already show the group.

The token itself is never stored. SHA-256 of 32 random bytes, like a session (M1-06): a database dump yields no usable link.

### 2. Reading a link must not spend it

Signal fails at gravesides. Somebody opens the link, loses the connection, opens it again — and has not used up their one tap: `handoverTokenSubject` reads without redeeming, and only the POST spends it.

That distinction produced the one real bug in this task. The first version rendered the confirmation screen by re-reading the token, which had just been spent — so the person who tapped correctly was told _"That link has already been used."_ The done screen now reads the collection by id. It is in a comment where somebody would otherwise reintroduce it.

### 3. The host's tap is a line on the record, not a status

`handover_status` records **who closed the record** — a witness who was there, or the organiser on her own word. A host acknowledgement is a separate column, `host_acknowledged_at`.

Making it a status would erase that distinction the moment a family tapped a link, which is exactly backwards, and it would make the host's action look like the completion of the handover. Rule 15 says the host does nothing in the system; Part D2.4 designed around them being unreachable. **No ledger entry follows a host tap**, and a test asserts the chain still has exactly one entry afterward.

### 4. `handover_confirmed_member_id`, and null as a fact

Free text could say "witnessed by Thandi Ngcobo" without anybody having witnessed anything. The FK makes it a fact, and **null is exactly the organiser-marked case** — nobody was there to tap it.

The incwadi reads that null directly: _"Marked handed over by Nomsa Mthembu, on her own word."_ The design's line is the justification — _"It is worth less than a witness's tap, and anyone reading it later will see the difference."_ That difference is on the paper, permanently, rather than smoothed away.

### 5. No photo, and the criterion is deferred rather than met

M2-11's third criterion — _"evidence photo EXIF-stripped per M4-01 rules"_ — cannot be met, because M4-01 does not exist.

A JPEG straight off a phone carries GPS coordinates. On a funeral handover those are the family's home address, published to anybody holding the link. The two ways to ship a photo today were improvising a stripper inside a task about something else, or building a second one that duplicates M4-01 — leaving two of them to disagree later. Both are worse than waiting.

So the fallback is the organiser's word, the copy says so plainly, and `collections.handover_evidence_key` sits unused. A test asserts the copy claims no photo and no upload, so the gap cannot quietly close in prose while staying open in code. The plan records it against M2-11 and against M4-01.

### 6. The incwadi, and where the album starts

_"Print this and hand it over with the money. The family keeps it. Years later this page may be gone and the paper will not be."_

That sentence is the specification. `/c/[slug]/incwadi` is server-rendered HTML with print styles: names, amounts, total, who collected it, that we checked her identity, what the group took off the family's list, and how the handover was confirmed. Printing is the browser's.

**This is not M4-02's album** — messages and photos across an umcimbi with the strand as its cover — and not M4-03's PDF with real bleed. The boundary held: nothing here needed the album, because everything on the sheet is computed from rows that already existed after M2-09.

Two print details that are not decoration: `break-inside: avoid` so a name and its amount cannot land on different sheets, and a `screenOnly` class so instructions about printing do not print. The sheet is a `<main>` landmark, which axe asked for and a screen reader wants anyway.

### 7. Links are shown, not sent

No BSP exists (M2-08), so the organiser's screen prints the link and she passes it on the way this group already talks. **No new WhatsApp template was registered**, for the reason M2-08 §6 gives about the payout templates: one that looks reviewed and has never been exercised is worse than an obvious gap.

Issuing a witness link again replaces the previous unredeemed one for that person. Plans change, and two live links for one person is a capability nobody is tracking.

### 8. The single-use guard needed a test that could see it fail

Removing the conditional `UPDATE` from the witness path broke nothing: the ledger append is itself conditional on the handover not being closed (M2-09), so the second tap still refused — with a different message. That is the shape M2-05 §7 warned about, a guard whose removal no test notices.

**The host path has no second guard.** Nothing behind it refuses a repeat, so the conditional update is the only thing making that link single use. The test that proves it races two taps on an unspent link and expects exactly one to win — and it had to be written that way round: an earlier version spent the link sequentially first, so both racers failed for the wrong reason and the mutation passed.

### 9. What a spent link leaves behind

`pruneHandoverTokens` deletes anything redeemed or expired. They are capabilities, not evidence — what the handover _means_ lives in the ledger entry and on the collection, neither of which the pruning touches.

---

## M3-01 · Identity verification adapter

### 1. Two qualifications on the done-criterion, recorded rather than quietly met

The criterion is _"a test proves no plaintext ID number and no image reaches storage or logs"_. It is met, and the sentence is worth being precise about.

**No image reaches storage or logs because no image is ever captured.** There is no selfie step. Whether there should be depends on a vendor nobody has chosen, and the three candidates do not have the same shape: VerifyNow and Datanamix return the Home Affairs photograph for us to compare against a live selfie — capture, upload, and images we then have to be trusted not to keep — while Didit runs liveness and face match inside its own hosted flow, where no image reaches us at all.

**If the vendor chosen requires capture, this criterion has to be earned again in the task that builds it.** It does not inherit from here. That sentence is in `tests/unit/identity-no-pii.test.ts` as well, because that is the file somebody will read when they next touch this.

**"Peppered ID hashing via KMS" is not met either.** The pepper is `ID_NUMBER_PEPPER` from the environment, the same stopgap M1-02 §5 recorded for the column encryption key, and no KMS has been chosen. It was on neither open-items list and now it is, as architecture §15 item 13 and Part J item 2a.

A `SecretProvider` interface was considered and rejected: `hashIdNumber(idNumber, pepper)` already takes the pepper as an argument, so the seam is exactly where it needs to be and the move costs one function in `src/lib/identity.ts`. An interface for a single caller is the "one guard with a spare" shape M2-05 §7 warns about.

### 2. The interface accepts either vendor shape without presupposing one

`VerificationStart` is `{ kind: 'inline', outcome }` **or** `{ kind: 'redirect', reference, url }`, and liveness and face match are flags on the outcome that a provider not offering them reports as `null` — which is deliberately different from `false`. A page must not read "not checked" as a person who failed a liveness test.

Only the inline path is built. The redirect path exists so that choosing Didit is an adapter rather than a change to the flow, and the in-memory verifier exercises it under one sandbox identity so it cannot rot unnoticed.

### 3. Nothing in the outcome types can carry an image, and that is the mechanism

There is no field of type bytes, no base64, no URL to a photograph anywhere in `src/domain/identity/verifier.ts`, and no image column in either new table. An adapter handed a Home Affairs photograph therefore has **nowhere to put it** and has to drop it on the way in, rather than remember to.

The test that proves this is in two halves, because either alone would be worth little:

- **Behavioural.** The in-memory verifier deliberately builds a vendor response carrying a synthetic photograph and the plaintext number it was given, keeps the raw payloads in memory the way `lastSmsTo` does, and the test asserts the payload really did contain both and that the outcome, the database rows and the audit log contain neither. Without a hostile payload the assertion would be vacuous — of course nothing leaked, if nothing was there.
- **Source scan.** The M1-06 §7 posture: not "does not log the number" but **does not log**. The failure to guard against is somebody adding a `console.error(error)` while debugging a provider problem, which is exactly when it feels reasonable and exactly when the argument being logged is an identity document. Both halves were mutated and both failed: a `console.error` on the catch path, and a `photoBase64` field added to `VerificationChecks`.

The scan also holds that the plaintext exists in exactly two files, that the repository never sees an unhashed number, and that no `redirect(` line anywhere on the path mentions one.

### 4. Consent is a second table, insert-only, and the foreign key is the enforcement

`identity_consents` holds no UPDATE and no DELETE grant — the posture of `ledger_entries` and `audit_log`. `identity_verifications` needs UPDATE, because a pending check becomes a verified or failed one, and it carries a **NOT NULL foreign key to a consent**.

So _"timestamped consent capture before any check"_ is a property of the schema rather than an ordering somebody has to remember. `canStartVerification` also refuses without consent, and that is defence in depth of the kind M2-05 §7 says is worth having: the second layer is the database and can be observed refusing, which an integration test does.

It records **what** was agreed to and not only that something was: the copy key, its version, and a SHA-256 of the exact words on screen. The statement is one string in `src/copy/verify.ts`, rendered as one paragraph, so what was stored and what was read are the same bytes. Changing a word means bumping `CONSENT_VERSION`.

### 5. The identity hash is on the attempt, and promoted to the organiser only on success

This was not the first design. The migration originally said an attempt would carry no hash at all, on the grounds that a second copy is a second place an identity can be looked up.

**That does not survive contact with the polling flow.** The answer arrives on a later request, when the plaintext is long gone, so something has to carry the identity from the start of the check to the moment it passes.

The alternative — writing `organisers.id_number_hash` at the start and clearing it on failure — is worse in a way that matters: one mistyped digit would park **somebody else's identity** against this account for as long as the check ran, and the real owner would be refused while it sat there. So the hash lives on the attempt, is deliberately not unique there (two attempts on one number are two attempts), and is promoted into the organiser's unique column in the same transaction that marks them verified.

### 6. Terminal once, and reporting what was actually written

A verified check cannot become a failure and a failed one cannot quietly become a pass. A later answer is a **new check**, not an edit to this one — the record of a check is evidence with a retention period (§7.3).

Two things came out of testing this and neither was in the first version:

- `applyVerificationOutcome` now returns **what it wrote**, not what it was handed. A check that passed at the provider and then met the unique index on the identity is stored as `duplicate-identity`, and the first version reported it as `provider-unavailable` — telling somebody Home Affairs did not answer when Home Affairs answered fine. Found by the e2e suite, because the development database outlives a run and the fixture identity had already been claimed.
- A caller holding a record that was settled while it was working gets `unchanged` rather than its own outcome. Without that, a second tab renders a failure over a badge that was earned.

`startVerification` also refuses to demote a `verified` organiser to `pending`, which `canStartVerification` already prevents at the application layer and which the database now prevents regardless of the caller.

### 7. Polling is the page reloading itself, with no script at all

`<meta http-equiv="refresh">` on the pending state, at 2, 3, 5, 8 and 13 seconds as the check runs on, and each load asks the provider **at most once** — the slot is claimed with a conditional UPDATE on `last_polled_at`, so a phone and a laptop open on the same check cost one call rather than two.

A JSON route plus a small enhancement, like `public/needs-board.js`, would be the nicer experience. It was not taken: it is a new pattern for a page somebody sees once, and the reload version works with JavaScript off, which is a property this product keeps needing. An e2e test runs the whole flow, wait included, with `javaScriptEnabled: false`.

A 120-second answer (§5.6) is therefore about a dozen reloads. `PENDING_DEADLINE_MS` is four minutes, comfortably past it, after which the check is recorded as `timed-out` — distinguishable from a negative answer, because one is ours to retry and the other is theirs to correct.

### 8. Three checks per organiser per day, counted from the rows

This is the first thing in the product where a retry loop spends **real money** — about R30 a call at VerifyNow's rate. Three is a typo, a correction, and one more.

Counted from `identity_verifications` rather than from a counter column, the same reasoning as M1-06 §4 one layer up: a count that has to be maintained is a count that can disagree with the rows.

Everything checkable for free is checked before anything costs anything: length, digits, a possible date of birth, the citizenship digit, and the Luhn check digit the number carries for exactly this purpose. That last one catches most single-digit slips and every adjacent transposition — asserted, along with `5306075800082` being the sandbox identity Stitch documents, which is a useful check that our Luhn agrees with a published one.

A duplicate identity is also caught **before** the provider is called. The attempt is opened first so that an enumeration attempt leaves a record and counts against the three, and what the organiser is told never confirms that somebody else holds that number — that would make the form an identity-enumeration oracle for anybody with a list of ID numbers.

### 9. `/verify` is organiser-level, and that is what closes the collection gap

Verification is a property of the **person**, not of an umcimbi, so one check serves every event they set up and every collection they run. Step five of the setup flow renders the same component inside its shell rather than a second implementation of it — one screen, one file, the lesson `design/` learned in M1-01 §12. The step keeps its own heading and lead, because that copy is verbatim from `design/setup.html` and explains why the check exists before asking for anything; `/verify` is reached by somebody who already knows why they are there.

The collection organiser's screen now links to it. Until now she reached a refusal with no way through — the gap M2-10 §10 left open deliberately, because there was nothing to point at.

`?returnTo=` is validated rather than trusted. An open redirect on a signed-in page is precisely the shape of the scam this product exists to be distinguishable from.

### 10. What this does not do

**`canPublish` still carries no verification clause.** M1-07 §5 left it out because a check against a status nothing ever sets is a gate that always passes; something sets it now, and adding the clause is M3-02's job rather than a change smuggled in here.

**The OG card still draws no badge.** `cardFacts` sets `verified` as a constant `false` (M2-07 §5), and the badge is in the version hash, so the day M3-02 turns it on every card already sitting in a chat stops being the current one.

**The collection page needed nothing.** `canShare` already read the status and the verified line already rendered from `idVerifiedAt`, so both started working the moment a check could pass — which is what M2-09 §8 and M2-10 §5 were written against.

Three copy strings that said the check was not switched on are gone, because they are now false: `setupCopy.verify.notYet` and `notYetBody`, and half of `collectionCopy.shareBlocked`. `shareCopy.badgeNotYet` was rewritten rather than removed — the card genuinely still carries no badge, and it now says that rather than saying the check does not exist. Same treatment `eventCopy.needs.notYet` got in M2-04 §8.

**No report channel is promised**, because M3-06 has not built one. A failure that is not worth retrying says so plainly instead of pointing at a channel nobody can reach — the failure M1-08 §5 refused on the event page.

### 11. Two things found while running the suite, one of them not ours

**The e2e `settle` helper waited for the wrong thing.** It reloaded until the pending screen was gone, and the form is also not the pending screen — so a reload issued while the submission's navigation was still in flight passed instantly on the wrong page and failed on the assertion after it. It now waits for a terminal screen. Worth knowing generally: on this stack, "the old thing has gone" and "the new thing has arrived" are not the same wait.

**Three tests in `tests/integration/notifications.test.ts` fail, and they are not M3-01's.** `does not hold an immediate message` and the two `who is told what` cases enqueue with the real clock and then flush at a fixed `2026-08-17T01:00:00Z`, while `dueNotifications` filters on `scheduledFor <= now` — so they pass only when the suite is run before 03:00 SAST and fail for the rest of the day. Nothing in this task touches messaging. It is a real bug in those tests rather than in the code they cover, and it belongs to whoever next opens M2-08.

---

## M3-02 · Verified badge and publish gating

### 1. The gate is in two places, and the second one is Postgres

`canPublish` gains a `not-verified` blocker — the clause M1-07 §5 deliberately left out, because a gate against a status nothing writes always passes and looks like one that does not.

`publishDraft` carries the same condition **inside the UPDATE**:

```
where: { id, organiserId, status: 'draft', organiser: { is: { idVerificationStatus: 'verified' } } }
```

M2-05 §7 says two application-level checks of one condition are one check with a spare, because neither one's removal is noticed. This is the case that entry allows for: the second layer is a different system, it refuses atomically, and an integration test calls the repository **directly, never touching `canPublish`**, and watches the row stay a draft.

It is deliberately not a read of the organiser followed by a write to the event. That reintroduces the race the conditional update exists to close, in the one statement deciding whether a page that asks strangers for money becomes reachable.

The action honours the answer rather than assuming it. The draft was read a moment earlier and what it said about the organiser is a moment old; reporting a publish Postgres declined would leave her looking for a link that does not exist.

### 2. `not-verified` is checked last, and the order is the decision

Blockers surface one at a time. The other four are each one field away on a screen she is already on; this one sends her to another screen. Discovering "go and be verified" first and "you also have no title" afterwards is the wrong order to find two problems in.

By the time she reaches the share step the other four are usually satisfied anyway, so in practice this is the only one that fires.

### 3. A native `<details>` on an organiser screen — and why that is not a reversal of M2-06 §3

M2-06 §3 refused `<details>` for the Ledger Strand. That refusal stands and this is not a drift from it, so the two entries should be read together.

**The public event page holds one posture: every interaction is a server round-trip, no exceptions.** Claiming, undo, contributing and opening a bead are all form submissions, and a `<summary>` is not a `<button>` however well it behaves. A second mechanism that happens to be cheaper on one interaction would cost the page its single posture.

**An organiser screen is a different context.** She is signed in, mid-flow, and the answer to _"Why can't I skip this?"_ belongs where the question is asked rather than on a screen she has to come back from. Zero JavaScript either way.

So: **the public pages keep one posture; organiser screens may use native disclosure.** That is the boundary, and it is a boundary rather than an erosion because the reason for the first rule does not apply on the second kind of screen.

The disclosure's content is `setupCopy.verify.why`, which is the design's own copy and explains rather than instructs — a test asserts it contains neither "you must" nor "required".

### 4. The badge is read, never assumed — including where it now cannot happen

After this task a published event implies a verified organiser, so `eventCopy.organiser.unverified` and `trust.checkedNothing` should never render. Both stay, and the page reads `organiserVerifiedAt` rather than inferring it from the fact of publication.

A page that assumes will eventually assert something false, and this is the assertion people decide whether to send money on. There is an e2e test for the unverified page precisely because it should be unreachable — if verification is ever revoked, or a row is repaired by hand, the page says the honest thing without anybody having thought about it in advance.

The badge is above the fold, in the header beside the name it belongs to, with the date. The tick is `aria-hidden` and the accessible name carries the name and the date, because a tick on its own says nothing to a screen reader.

### 5. Two hard-coded `false`s, and the second one was the bug

`cardFacts` set `verified: false` as a constant (M2-07 §5) and now reads the organiser. That was the expected change.

**The image route had a second one**, and it was invisible until the badge became real: it drew `<OgCard verified={false} />` while the URL's version hash — computed from `cardFacts` — already said the card was badged. So a verified event minted a new image URL, WhatsApp refetched it as designed, and got back a card with no tick, cached for a year as `immutable`.

Found by an e2e test that seeds two events identical in every drawn fact except the badge and asserts their bytes differ. The route now draws from `identity.facts.verified` — the same object the version was hashed from — so there is one source of truth for what the picture says, which is what M2-07 §1 was reaching for when it put the facts and the version in one place.

The version hash covering the badge is also what makes the rollout free: an event that gains a badge changes its image URL, and every card already sitting in a chat stops being the current one without anybody running a job. A test asserts the version changes with the badge and **does not** change with the date of the check — the card draws a tick, not a date, and re-running a check must not invalidate every card in every chat for a difference nobody can see.

### 6. The tick on the card is drawn, not typed

The first version used `✓`. Satori answered with **"Failed to load dynamic font for ✓. Status: 400"** on every card: Public Sans carries no U+2713, and `next/og` responds to a missing glyph by fetching a font over the network — a request per card where it succeeds, and the exact behaviour M1-05 §1 hardcoded the `@font-face` rules to prevent.

The tests passed anyway, because the card still rendered and still differed from the unbadged one. It was caught by reading the server log during an e2e run.

It is now an inline `<svg>` polyline, which needs no font at all. A unit test asserts the card's markup contains nothing outside latin, so a glyph the two committed faces cannot draw fails there rather than in somebody's chat.

The HTML page keeps the character: a browser falls back to a system font locally and costs no request, which is a different situation from a server-side renderer with two font files and no network.

### 7. `shareCopy.badgeNotYet` is gone, and this is its third rewrite

The prototype's _"Every person who opens it sees your verified name"_ was refused at M1-08 §5 because nothing was verified. M3-01 replaced it with a line saying the badge itself was not wired. Both are now done, so `badgeCarried` says what the card carries — and since an event cannot be published unverified, there is no unverified card left to describe.

`shareCopy.introVerified` has been sitting unused since M2-07 for exactly this moment and now renders. `setupCopy.verify.notYet` went in M3-01; `collectionCopy.shareBlocked` lost its "not switched on" half in the same task. That is four strings in three tasks whose only job was to be true until something existed — which is the cost of the honesty rule, and it is worth it.

### 8. One date formatter, because there are now two callers

`formatDayMonth` in `src/lib/dates.ts`. The collection page had the only copy of it (M2-10 §5) and the event page now renders a verification date too. There is no version of this product where the two should format one differently.

`formatEventDate` stays separate and keeps its weekday: _"Saturday, 15 August"_ is how somebody decides whether they can be there, which is a different question from when a check was run.

### 9. The size gate had been measuring a build that no longer existed

The gate's fixture organiser is now verified, because since this task a published event cannot exist otherwise — a fixture without it would be measuring a page the product can no longer produce.

Checking that turned up something worth recording. **`pnpm gate:size` measures whatever is in `.next` and does not check that it is current**, and `pnpm build` fails without production environment variables — which is correct (M1-07 §7's boot guard) and means a build can quietly not have happened. The last two runs, including one in M3-01, reported numbers from a stale build.

Measured properly, against a fresh production build:

|                        | before  | after       |
| ---------------------- | ------- | ----------- |
| `/e/[slug]` first load | 34.8 KB | **35.1 KB** |
| `/c/[slug]` first load | 31.6 KB | 31.8 KB     |
| LCP, slow 3G           | 0.61s   | 0.59s       |

The badge costs about 300 bytes compressed, against a 150 KB ceiling. Confirmed by fetching the fixture page off the production server and finding _"ID verified 12 August"_ in the header and the trust panel's verified block in the body — the number is the page that ships, which was the point of updating the fixture.

**The gate should verify its build is current.** It is a real hole: a green gate measured on stale output has stopped measuring anything, which is the same failure M1-08 §1 refused when it declined to set the budget at a number the page could pass. Not fixed here, and it belongs to whoever next touches `scripts/size-gate.ts`.

### 10. The check now answers inside the setup shell

M3-01's action always redirected to `/verify`, so submitting from step five threw the organiser out of the six-step flow and onto the standalone route mid-setup. The form now carries an `on` field — the path to render the answer on, validated the same way `returnTo` is — so the pending page and the result appear where she already is.

`returnTo` and `on` are different questions: one is where "Carry on" goes, the other is where the answer is drawn. Collapsing them would mean a check started from a collection could only answer on the collection screen, which is not where it belongs either.

### 11. Two test-suite consequences, both real rather than incidental

**Every e2e fixture that publishes now needs a verified organiser.** Most seed `status: 'published'` directly in the database, which is state-setting rather than a door in the product (M2-10 §8) and is unaffected by an application gate — but the _badge_ is read from the organiser, so a fixture without one would render a page the product cannot produce. The seeds default to verified and take `verified: false` explicitly for the one test that wants the honest unverified page.

**The setup-flow specs run the real check.** They use the in-memory verifier's `0000` sandbox identity, which answers on the first call, so a spec whose subject is publishing does not spend twenty seconds reloading a pending page. The polling path is exercised where it _is_ the subject, in `verify.spec.ts`. The axe walk gained four screens — the blocked share step, its open disclosure, the check, and the result — and is marked `test.slow()` rather than trimmed: dropping a screen from the walk would be paying for a green suite with coverage.

---

## M3-03 · Witnesses (abakhaphi)

### 1. `replaceWitnesses` deleted everybody on every save, and that had to go first

Not in the task, and the task could not be built on top of it. Every step of the setup flow saves what is on screen before doing anything else (M1-07 §8), so `saveWitnesses` ran on "add a third umkhaphi" — and `replaceWitnesses` deleted every row and wrote them again.

That was harmless while a witness was a name and a number. It stopped being harmless the moment a witness had an **acceptance and a live invite link**: adding a third person would have wiped both, for both of the others, silently, with nothing in the interface to suggest anything had happened.

It reconciles on the phone number now — which is what identifies a person here and what the unique index was already on. A row still in the list keeps its id, its status and its invite; only somebody actually removed is deleted; **a renamed row keeps its answer**, because correcting the spelling of somebody's name is not un-asking them.

Reverting to the delete-and-rewrite fails two integration tests and nothing else, which is the right blast radius.

### 2. `/w/`, `/h/` and `/k/` — three capability routes, written down before they blur

| route        | who holds it                                       | what it does                                                            | lives                  |
| ------------ | -------------------------------------------------- | ----------------------------------------------------------------------- | ---------------------- |
| `/w/<token>` | a member of a collection, standing at the handover | closes the record (M2-11)                                               | 30 days, single use    |
| `/h/<token>` | the host family, optionally, afterwards            | adds a line to a record already closed, and is never required (rule 15) | 30 days, single use    |
| `/k/<token>` | an umkhaphi on an event                            | accepts or declines standing with the family (M3-03)                    | 30 days, answered once |

All three are 32 bytes from the CSPRNG, stored as a SHA-256 so a dump yields nothing presentable, scoped to one person and one thing, and **none of them moves money**. All three are refused across origins by `Sec-Fetch-Site` (M2-04 §6) and served `no-store`.

They are easy to confuse now that there are three, which is the reason for the table rather than a preference for tables. `k` is for umkhaphi.

### 3. The token is a column, not a table

`handover_tokens` is a table because a collection has many links at once: two kinds, several members, reissued as plans change. A witness has exactly **one** live invite, so a hash and an expiry on the row say the same thing without a join, and "issuing again replaces the old one" is an UPDATE rather than a delete-and-insert.

A CHECK keeps the pair whole — a hash with no expiry is a link that never dies, an expiry with no hash is a row describing a link nobody holds — and a second CHECK keeps the answer and its timestamp agreeing in both directions, so no row can say `accepted` without being able to say when.

### 4. A spent link stays readable, and that is the M2-11 §2 lesson arriving twice

The first version cleared the hash on answering. It is the obvious thing: the capability is used, so remove it.

It is wrong, and the e2e caught it: somebody re-opening their own answered link landed on _"that link is not one of ours"_ — telling the person who answered correctly that they had done something wrong. That is exactly the bug M2-11 §2 had to fix on the handover tap, reached by a different road.

So the link stays readable and shows them their own answer. It grants nothing: the update is conditional on the row still being `invited`, and `checkInvite` refuses before it.

**It arrived a third time, as a reload.** Rendering the answer straight out of the POST meant `reload()` re-submitted it, and the second POST was correctly refused — so the page turned into a refusal under somebody who had done nothing but refresh. The answer is POST-redirect-GET, which is what M2-04 §1 chose for claiming and for the same reason. Three routes have now met this; it is worth treating as the default posture for any public POST rather than a thing each one discovers.

### 5. Publishing needs a named umkhaphi, not an accepted one

`canPublish` counts rows, unchanged. Gating on acceptance would block a funeral page on somebody else tapping a link — somebody who may be travelling to the same funeral, or burying the same person.

Nothing is claimed that has not happened, because the page names **only those who agreed**. An outstanding invitation is invisible to the public and visible to the organiser, which is the correct split.

### 6. Honour, not audit — and the tests are mostly about the words

The public line is one sentence beside the organiser: _"Standing with them: Thandi and Sipho."_ No count, no status, nobody who declined, no phone number. A name there means that person said yes.

**A decline is a private answer to a private question.** Publishing it would turn a courtesy into a record of who refused a grieving family. The organiser sees it; nobody else does.

The invite page carries the design's own sentence and its weight — _"not a small thing"_ — and declining is a **full-width button the same size as accepting**. A page that makes "no" small is collecting agreements rather than asking a question.

Half of `tests/unit/witness.test.ts` is about register rather than behaviour, deliberately: the same flow written as a compliance check would pass every behavioural test in the file. It asserts that no string anywhere says audit, verify, approve, compliance, authorise, monitor or oversight; that the two Part D anchor lines survive word for word; that the relation hints stay hints (no "must", no "required", no "independent" — the second one is governance advice expressed as family instinct and must not stop being that); and that nobody who says no is argued with.

### 7. The setup screen's promise and the invite's question are asserted against each other

`setupCopy.witnesses.askQuote` and `witnessCopy.invite.question` are compared for equality in a unit test. The organiser is shown what the person will be asked; that has to be what the person is actually asked, and a shared test is cheaper than a shared string that somebody later parameterises differently.

### 8. _"We send them one message"_ had to go

It was future tense while nothing could be sent, and M1-07 §6 had a test pinning the tense. **M3-03 made it false rather than early**: we send nothing, and she passes the link on herself — the same posture M2-11 §7 took for the handover link.

The frame is rewritten to say what happens; the quoted question is untouched. The test that asserted the future tense now asserts the absence of the claim, because the tense had stopped being the point. Fourth string in three tasks to be corrected this way, after M3-01's two and M3-02's one.

### 9. One authored string, flagged as such

`design/event.html` has **no abakhaphi block at all**, so the public display line had no verbatim source. It is written in the register the rest of the copy establishes, and it is marked as authored in `src/copy/witness.ts` and here — the same treatment M2-07 §11 gave the English-only share message, so a reviewer can tell which strings were extracted and which were written.

Everything else in this task is extracted: the lead, the body, both relation hints and the ask quote are all `design/setup.html`, word for word.

### 10. A flex row that collapsed to nothing

The organiser's list of who she has asked first put the status and the "they said no" note inside a `.row` flex container beside `.rowMain` (`flex: 1; min-width: 0`). The note has no flex basis of its own, so it took the width and `min-width: 0` let `.rowMain` shrink to **zero** — the status was in the DOM, correct, and invisible.

Playwright reported it as `hidden` while the accessibility snapshot showed the text present, which is a confusing pair of symptoms worth recognising: a zero-width flex child is _there_ and _not visible_. The list is a stack of cards now, using the same classes the rest of the step does.

### 11. What the gate measures

The size-gate fixture now has **two accepted abakhaphi**, for the reason M3-02 gave for verifying its organiser: a page with nobody standing on it is the empty case, not the ordinary one, and the gate has to measure what ships.

`/e/[slug]` went 35.1 KB → **35.3 KB**, LCP 0.63s on slow 3G, against a 150 KB ceiling.

---

## M3-04 · "Is this real?" panel — and M3-05, `/check`, built with it

### 1. The two were one thing wearing two numbers

M3-04's panel is, in substance, an instruction to go to `/check`. Shipping it pointing at a 404 would teach the opposite of what it says on the one page whose subject is whether things are what they claim to be — and shipping without the link would have made the copy the fourth string in four tasks written to be temporarily honest, after M3-01's two, M3-02's one and M3-03's one.

M3-05's own line in the plan calls it _"the canonical route the trust panel and verify screen both point to"_, and its only dependency was M3-02. So it is built here, and the plan records that rather than leaving a number that looks outstanding.

### 2. The link and _"do not tap a link"_ are in tension, and the tension is the point

The design's instruction is _"Type isipheko.co.za/check into your browser yourself and enter the code … Do not tap a link to get there."_ Adding a tappable link partly undercuts it, and that is a real cost rather than an apparent one: **on a fake page, a link labelled "check" goes wherever the faker wants.**

What settles it is the other side. Somebody determined to check and given nothing to tap will search _"isipheko check"_ and land on whatever ranks, which is worse than a link we control on a page that is genuine — which is nearly all of them. The instruction is the protection; the link is a convenience for the common case.

Two conditions, both asserted:

- **The instruction stays above the link and keeps its prominence.** It is not a caption under a button. A test compares their positions in the markup, so a later tidy-up cannot quietly invert them.
- **The link is labelled with the literal address**, `isipheko.co.za/check`, not "Check this event". A label showing the destination teaches the shape of the real one, which is what helps somebody recognise a fake later — and it means the link and the instruction reinforce each other instead of competing.

It also carries `rel="noreferrer"`: the answer must be independent of the page being checked, and a `Referer` header would quietly make it not.

### 3. The panel was missing from the flow where it matters most

`/e/[slug]` had it. **The contribution flow had nothing** — no panel, no safety line, no badge — and that is the flow where somebody is looking at a phone number they are about to pay, having navigated away from the page that carried the reassurance.

So the two sentences that matter travel with them on every step: _"Do not use a number on this page. If the page were fake, the number would be too"_, and the address to type. The badge comes too — it was absent there with a comment saying nothing had been checked, which was true at M2-05 and false since M3-02.

### 4. Not styled as a warning, and that is a design position rather than a default

Paper, ink, a rule above it. **No `role="alert"`** — that is for something that has just gone wrong, and this panel is permanent: it is on a page where everything is fine, and an alarm that is always sounding is an alarm nobody hears. No error colour either, because there is no error colour in the palette and this is not the place to invent one (M1-05 §4).

The heading is a question — _"Is this real?"_, _"Not sure this is real?"_ — and the intro answers _"A fair question."_ A panel that opened by telling somebody to be careful would be doing the scammer's job of making the page feel like a place where care is needed and then reassuring them.

Asserted on the CSS rather than by eye: both blocks take `var(--paper-raised)`, declare no colour literal, and declare no accent.

### 5. `/check` wears no archetype

Every other public page takes the accent. This one does not, deliberately: it is an answer **about** a page, and an answer dressed in that page's colours would be the check wearing the costume of the thing it is checking. With nothing declared, `var(--accent, #16233D)` renders indigo (rule 2) — which is the right posture for a page that belongs to nobody's ceremony.

It also **offers no way through to the umcimbi**. An answer that opened the page would let a fake link use `/check` as a step on the way, and the answer has to be able to stand on its own.

### 6. A draft answers exactly like a code nobody was issued

M1-07 §7 made drafts unreachable and this was the obvious place for that to spring a leak: a lookup distinguishing "not published yet" from "not one of ours" would be the one way to discover that a family has a page they have not shared.

The copy carries the consequence rather than hiding it: _"A page that has not been shared yet also answers this way. If somebody has sent you a link and this says nothing matches, that is worth stopping over."_ Both an integration test and an e2e assert the two answers are identical.

A malformed code gets the same answer too — telling somebody which of their guesses were the right _shape_ is the only free information available here.

### 7. What it answers with, and the shape test

Title, organiser's name, whether their identity was checked and when. **Never a phone number, never an amount, never a contributor, never the needs list.** Somebody reaching `/check` could have reached the event page, so it must not become a way to learn more by asking sideways.

The test asserts the **whole key set** of the result rather than the absence of particular fields, so a column added later has to be considered rather than arriving by accident on an endpoint that takes no session.

A contribution's reference resolves to **its event**: the person holding the code off their own payment is the likeliest checker, and the event is what they are asking about. Their contribution's own details are not returned, because this endpoint could not know it was them.

### 8. The rate limit is in memory, and says so

Every other limit in this product counts rows the action itself writes (M1-06 §4, M2-04 §6). A lookup writes nothing, so counting it would mean a row per public read in an append-only table nothing may prune — a worse thing to own than a weak limit.

Architecture §10 puts rate limiting at the Cloudflare edge **and** in the application; for an unauthenticated public read the edge is the half that works. This is the other half, and it is a speed bump rather than a control.

**Enumeration is not what it defends anyway.** A reference is three letters and six Crockford characters — about 1.9 × 10^13 — and a slug is 95 bits. Guessing is not a strategy at any rate limit; what this bounds is somebody making the lookup expensive for us.

### 9. Two things corrected on the way past

**The report promise.** `trust.wrongBody` carried the prototype's _"Report the page from isipheko.co.za and we will hold every payment on it until a person has looked."_ There is no report channel (M3-06) and no payment we could hold — the organiser is paid directly. Two false promises inside the panel that exists to be believed. What ships is the half that is true and costs nobody anything: _do not give anything, nothing is owed by opening this_, and plainly that there is no way to report to us yet.

**`parseLookup` did not read the link it claimed to.** It took the last path segment, so `/e/<slug>/contribute` resolved to `contribute` — while a comment asserted both worked. It scans every segment now. Somebody pasting the page they were part-way through is doing exactly what this is for.

### 10. The self-referential rule is a scan, not a review

The done-criterion is a property of **all** copy, so `tests/unit/trust-panel.test.tsx` reads every file in `src/copy/` and fails on a toll-free or international number, or on any instruction to call, phone, ring, dial or contact us.

It deliberately does **not** ban phone-shaped strings outright: `auth.ts` shows `082 123 4567` as the shape of the field, which is a placeholder and not somebody to reach. The rule is that no number is offered as a way to check, and that nothing tells anybody to ring us — we publish no number, so a number in this product's voice would be one somebody else put there.

### 11. What the gate says

`/e/[slug]` went 35.3 KB → **35.6 KB** and `/c/[slug]` 32.0 → 32.3 KB, LCP 0.65s on slow 3G, against a 150 KB ceiling. The panel in the contribution flow is the only thing on the critical path that grew.

---

## M3-06 · Report channel

### 1. STANDING RULE — a report does nothing by itself

**This is not a note about M3-06. It is a rule for the product, and it will be under pressure.**

A report does not flag, hold, hide, unpublish or otherwise change the event it names. **A person decides; the record records.**

The reason is not caution about false positives. It is that the reporter is anonymous by design — there is no account and never will be (rule 4) — so anything automatic here is automatic for whoever is willing to press it most. A form that changed a page would be a way to attack a family: file five reports on a funeral and watch the page change under people who are burying somebody. The abuse is cheaper than the use.

**The pressure to reverse this will arrive as a reasonable question**, probably the first time something bad gets through: _why didn't we catch that automatically?_ The answer is that the automatic version catches the wrong thing, and that a page taken down by strangers is a worse product than a page taken down slowly by a person.

If it is ever changed, it needs a mechanism that does not exist yet — an identified reporter, a threshold nobody can manufacture, an appeal that is not slower than the harm. Until then:

- `reports` has **no column** that could affect an event. Not `flagged`, not `held`, not `visibility`.
- `src/db/repositories/report.ts` contains **no write to an event**, and the file says so at the top.
- An integration test files five reports against one event and asserts the row is byte-identical afterwards.

### 2. The acknowledgement is the product, and it had to be something that arrives

57% of South Africans who report a scam hear nothing back. That is the finding this task exists against, and it means a form is the easy half: **a form that swallows a report is worse than no form**, because it spends the one moment somebody was willing to act.

No BSP exists (Part J item 3), so a message queues rather than sends — correct, and the whole reason the outbox exists (M2-08 §12). But it also means _an acknowledgement that arrives_ could not be a message today.

So it is two things:

- **A reference on screen, immediately.** `REP-4K7B2X`, from M2-02's generator, with the window on it and an instruction to write it down. It needs no provider, it arrives, and it is something the person can hold.
- **A queued message**, `report_received_v1`, where they left a number. When a BSP exists it goes; today it sits in the outbox as the durable record.

Where somebody leaves no number the screen **says so plainly** — _"this screen is the whole of what you will hear"_ — rather than describing a message they would then wait for. Reproducing the 57% by our own hand is the specific failure available here.

**The reference is deliberately not resolvable through `/check`.** A report code anybody could type in would let somebody read a report about themselves, and the reporter may well be in the same family as the person reported. It is its own namespace with its own prefix and no resolver.

### 3. The SLA is one working day, in two places that cannot drift

Stored on the record as `respond_by`, computed at insert, and stated in the copy — the same number in both, because a window that exists only in the interface is not a window (the M2-04 §4 lesson about the undo countdown).

Weekends are skipped: a report filed on Friday evening is answered on Monday, and saying so beats a deadline that was never going to be met and then quietly was not. **Public holidays are not handled** — there are twelve, and getting one wrong would move a deadline in the direction of promising more than we keep, which is the wrong direction to be wrong in.

`pnpm notify` prints the queue **every run, including when it is empty**. A number that only appears when something is wrong is a number nobody notices is missing: a quiet run has to positively confirm the queue was looked at rather than merely failing to complain. That is what being ghosted looks like from the inside — a job that says nothing and a queue nobody reads.

Counts only, no names, no titles, no detail. What is _in_ a report is among the most sensitive things this product holds: somebody accusing a family of fraud, possibly wrongly.

### 4. It takes a report about nothing we hold, which is the most valuable kind

Both foreign keys nullable, with what they were sent in free text. **A link that resolves to nothing is the scam case** — a page impersonating us, or a WhatsApp message with a plausible story and no page at all — and a form that could only accept reports about pages we host would refuse exactly the report worth having.

That is also why `/check` offers the report path on its not-found answer: somebody who has just typed a code and been told nothing matches is holding the most useful thing anybody could tell us, at the moment they know it.

### 5. Half a sentence restored, half still refused

The prototype's trust panel said _"Report the page from isipheko.co.za and we will hold every payment on it until a person has looked."_ M3-04 removed both halves because neither was true.

**The first half is now true and is restored**, with the window on it. The second half stays out and always will under Mode A: **no payment passes through us to hold** — the organiser is paid directly, and Mode B is gated on the legal opinion (§15 item 1). Restoring it would be the M1-08 §5 failure on the panel that exists to be believed.

Typed instruction primary, link beneath, labelled with the address — the `/check` discipline from M3-04 §2, now applied to a second route.

### 6. What the filed screen has to say, and why

Three things beyond the reference, each fixing a specific way somebody is let down:

- **When a person will have looked**, because the whole subject is not being ghosted.
- **Whether they will hear anything**, because a blank phone field otherwise becomes a wait for nothing.
- **That nothing changes on the page**, because somebody who has just reported a page will otherwise go back, find it unchanged, and conclude nothing happened. Nothing did happen to the page — deliberately — and saying so is the difference between a working system and one that looks broken.

The reasons are radios rather than a select: every option visible at once, none chosen by default, and it works on any browser that has ever existed. Somebody upset should not have to open a menu to find the sentence describing what happened to them.

### 7. Where the limit is counted, unlike `/check`

From the rows the form itself writes, like every limit that can be (M1-06 §4, M2-04 §6) — five an hour per address. `/check` had to settle for a counter in memory because a lookup writes nothing; a report is a row, so this one is real.

What it stops is a script burying the queue, which would hurt **the next person's report** rather than ours. Generous for the same reason as every other limit here: a church hall on shared wifi is ordinary, and somebody who has just seen a fake page may well tell us twice.

### 8. Two things the record does that are easy to get backwards

**`ON DELETE SET NULL`, not cascade.** A report about a page that was later removed is the report most worth keeping — cascading would delete the evidence at exactly the moment somebody acted on it.

**No DELETE grant.** Triage is an UPDATE — received, reviewing, closed — and that is all. The one thing that must not be possible is a report quietly disappearing.

### 9. The review screen is M3-07's, and the boundary is deliberate

M3-07 is _"append-only audit … minimal internal review queue for flagged events"_. This task built the record, the triage status, the SLA and the self-reporting queue; the screen a person works from belongs with the audit log, because the two are read together.

"Monitored queue" here means the queue exists, is ordered by its deadline, and reports on itself every hour whether or not anything is wrong.

---

## M2-08b · Threading `now` through the notification path

### 1. The premise was half right, and the half that was wrong was the interesting half

The task described three tests that "enqueue with the wall clock". They do not: `enqueueNotification` has taken a `now` since M2-08 and sets `scheduledFor` from it, and so do `confirmContribution`, `claimItem` and `warnExpiringClaims`.

**The tests were calling those functions without it.** The scenario ran on the wall clock, the flush was asked about a fixed timestamp, and `dueNotifications` filters `scheduledFor <= now` — so before 03:00 SAST the rows were due and after it they were not.

Worth recording because the diagnosis in the task would have sent somebody to fix a parameter that was already there.

### 2. And the second half of my own diagnosis was also wrong

Before writing anything I said `notification.createdAt` was a database default, which mattered because `buildDigest` computes the one-an-hour cap from it.

**`buildDigest` already supplies it**, with a comment saying exactly why: _"the hour-cap is measured from it: a default of `now()` would make the cap depend on the database's clock rather than on the one the flush was given."_ M2-08 got the one column a rule reads right.

I found this by mutation rather than by reading: dropping `createdAt: now` from `enqueueNotification` changed nothing, which it should not have if my account had been correct. **A mutation check that passes is a finding, not a formality** — it said the change was preventative rather than load-bearing, and that was worth knowing before claiming otherwise.

### 3. It is load-bearing after all, for retention rather than for the cap

`pruneNotifications` deletes on `createdAt < cutoff` for **both** tables, with the cutoff computed from a supplied `now`. So both columns are read by a rule; the cap is simply not the rule that reads them.

The proof was already in the suite, written as a workaround. The prune test enqueued at a simulated time and then **patched the row by hand**:

```ts
data: { status: 'sent', sentAt: old, createdAt: old }
```

That `createdAt: old` existed because the repository would not honour the clock it was given. Deleting the workaround is what makes the test depend on the fix, and it now fails without it — so the test that documented the bug became the test that guards against it.

### 4. Proved at two fixed times, not at whatever hour it happens to be

The three tests are now `it.each` over two timestamps each, chosen so the expected answer is identical at both:

- the immediate-message test at **03:00 and 14:00 SAST** — inside and outside the quiet window, because the point is that an immediate message is never held;
- the two digest tests at **10:00 and 18:00 SAST**, both inside the send window.

Two fixed times with one answer is what proves the rule. One fixed time and a wall clock proves the hour.

**Both mutations were run.** Reintroducing the original bug — `confirmContribution` without `now` — fails four cases. Dropping `createdAt: now` fails the prune test. Neither failure existed before this task, which is the point of it.

### 5. `startContribution` has the same shape, is untouched, and here is what the next person needs

**`contributions.created_at` is a database default**, and `startContribution` takes no `now`.

**A rule reads it**: M2-05 §6 voids a contribution nobody confirmed after fourteen days, and `pnpm expire` computes that cutoff from a supplied `now`. So a test that simulates time across the fourteen-day boundary will find the same trap — rows stamped by the database clock, a cutoff computed from a simulated one, and a sweep that deletes nothing or everything depending on the day it is run.

It is left alone deliberately: no test touches it today, the change belongs with M2-05's sweep rather than with notifications, and folding it in would have widened this task past the thing it was for. Whoever picks it up needs `startContribution` to take a `now` and write `createdAt` with it, and should delete any workaround they find in the sweep's tests first — that is where the evidence will be.

### 6. Why this is now a rule in CLAUDE.md

Two instances is a pattern: the ledger supplies `created_at` because the hash covers it (M2-01 §3), and these two columns because retention reads them. The rule is stated as _any timestamp a rule is computed against is supplied by the application, not defaulted by the column_ — the default stays for anything bypassing the repository, exactly as the ledger's does.

The cost of getting it wrong is not a wrong answer. It is **a test that passes or fails according to the hour somebody runs it**, which teaches people to ignore red — and a suite people ignore is worse than a smaller suite they believe.

---

## M3-07 · Audit log and admin review

### 1. Most of the log already existed, and the honest description of this task is "the rest of it"

`audit_log`, its grants and `src/lib/audit.ts` have been there since M1-06, carrying auth; M3-01 added identity. What was missing was everything an organiser does after signing in — publishing, confirming, closing a handover — and everything anybody does about a report.

So the shape changed rather than appeared. The taxonomy moved to `src/domain/audit/actions.ts`, which is pure and holds the closed set of action strings; the INSERT moved to `src/db/repositories/audit.ts`; `src/lib/audit.ts` kept the part that genuinely needs a request and a pepper — the fingerprint, the hashing, and one narrow writer per kind of actor so a call site cannot reach for the wrong one. `recordAuthEvent` and `recordIdentityEvent` kept their names and signatures, so no existing call site moved.

**The immutability needed no migration.** `20260807235900` already revokes UPDATE, DELETE and TRUNCATE on `audit_log` and sets `ALTER DEFAULT PRIVILEGES` to SELECT and INSERT, so the done-criterion _"log not mutable by the app role"_ was already true. What this task added is the proof at the layer it is claimed: the existing test asserted an ORM update is refused, which says nothing about a psql session or a migration script running as the app. `tests/integration/audit-and-review.test.ts` refuses raw SQL UPDATE, raw SQL DELETE and TRUNCATE, and reads the row back afterwards.

### 2. STANDING NOTE — the reviewer allowlist is a stopgap shape, not a design

`ADMIN_PHONE_NUMBERS` is a comma-separated environment variable, checked in `src/lib/admin.ts` against the organiser behind an ordinary session. There is no admin account, no admin password and no second sign-in.

**The argument that settles it against a database column:** the application role holds UPDATE on `organisers`, so an `is_admin` column would be a privilege the application could grant itself — and a flag the app can set on itself is not a privilege boundary, it is a field. The environment is something the running code can only read.

**It should be read as a stopgap and nothing more.** It has no roles, no revocation short of a redeploy, no record of who granted it, and it does not scale past a handful of people. A real admin model has all four. Nobody arriving later should take the allowlist for the intended answer, in the same way `ID_NUMBER_PEPPER` is not the intended answer to key management (M1-02 §5, Part J item 2a). It belongs on the same list.

Empty is valid and means nobody. A deployment with no reviewer is a queue that goes unread — a staffing problem, not a boot failure, and refusing to start would take the whole product down over a screen two people use.

### 3. Reading the queue is logged, not only acting on it

`admin.queue.viewed` and `admin.report.opened` are rows, alongside `report.triaged`.

A queue of reports is a list of families somebody has been accused of defrauding. Under a log that recorded only writes, an admin who opened every report about one family and changed nothing would leave **no trace at all** — which is the access most worth being able to see afterwards. Knowing who looked matters as much as knowing who acted.

Opening a report writes two rows: one against the report, one against the umcimbi. An event reported four times and read once is a different thing from one reported four times and never opened, and only a row against the event makes that visible where somebody would look for it.

`admin.access.refused` is the row worth alerting on: a signed-in organiser asking for `/review` is either a bug or somebody trying the door. **A request with no session is not logged** — that is an expired cookie far more often than it is anything else, and recording every one would bury the rows that mean something.

### 4. Triage writes to `reports` and to nothing else — M3-06 §1, one layer along

The standing rule is that a report does nothing by itself. **The hole that opens next is triage doing it instead**, because triage _is_ the human decision the rule reserves for a person, and letting the decision write through to the event would be one line of code and would read as obviously correct in review.

It must not. Closing a report records how far the reading has got. Whatever is decided about an umcimbi is done on the umcimbi, by a person, as a separate act with its own audit row. Held by four things:

- `triageReport` updates `reports` and nothing else, and there is no import of the event repository in `src/app/(admin)/review/actions.ts`.
- A unit source-scan asserts no `prisma.event.update`, `prisma.collection.update`, `unpublish`, `hideEvent` or `flagEvent` anywhere under `src/app/(admin)/`.
- An integration test reads the event row before and after a full `received → reviewing → closed` pass and compares it whole, then does it again with five reports all closed — **no threshold, in either direction.**
- The E2E test compares the rendered public page before and after, because what a family experiences is the page rather than the row.

Transitions are one-directional and there is no reopening: a reviewer who can walk a report backwards can walk it backwards to hide that they closed it. `received → closed` in one step is allowed — a report about a page that plainly is not ours is read and decided in one sitting, and forcing a two-step would make the extra step meaningless rather than deliberate.

The transition is checked in the domain and **again as a condition on the UPDATE**, the same shape as publishing (M3-02 §1). Two reviewers closing the same report produce one close and one honest refusal.

### 5. The reporter's number is on exactly one screen

It is on the detail screen and nowhere else — not in `reviewQueue`, not in `queueReport`, not in `pnpm notify`, not in any audit row.

It is there because **the SLA promises a person comes back to them, and that is impossible without it.** It is not in the list because a list is read at a glance, over a shoulder, and screenshotted. `reviewQueue` reads the column only to answer _is there any way back to them_ and returns that boolean; the number does not leave the function.

The copy says why it is on the screen, in one line. Otherwise the next person to build a review screen copies the field onto a list without noticing that what justifies it is the promise, not the record.

### 6. The payout hook is a comment, and that is the whole of it

`payout.requested`, `payout.approved` and `payout.released` are named in `src/domain/audit/actions.ts` with where they attach — the disbursement state machine in architecture §5.4 — and are **deliberately absent from the `AuditAction` union**, so a call site that reaches for one does not compile. `RESERVED_PAYOUT_ACTIONS` exports them as plain strings purely so a test can assert they are not writable.

Mode B is Milestone 5 and gated on the legal opinion (§15 item 1). There is no payout to request today, so a logger for one would be dead code wearing the appearance of a reviewed control — the thing somebody skims in a security review and counts as covered.

When M5 lands, the transitions are the call sites rather than the screen that triggers them: a payout approved by a witness and released by a job is two actors and two rows.

### 7. Confirmations target the umcimbi, not the row that changed

`contribution.confirmed` and `delivery.confirmed` are written against `targetType: 'event'`, with the contribution or claim id in the metadata.

The question the trail is read to answer is _what has happened to this event_. A log split one target per contribution answers nobody's question and cannot be assembled back into the one that was asked. `AuditTargetType` is deliberately coarse for the same reason — four values, not one per table.

This is also why the log is not a second copy of the ledger. The ledger records the entry and hashes it; this records **who was signed in when the entry was appended**, which the ledger row does not carry and which is the question asked after the fact.

### 8. What may appear in `metadata`, and how that is held

Outcomes, codes, counts, and the narrower row id the coarse target left out. Never a personal identifier, never free text.

The type cannot enforce it — every phone number is also a string — so it is held by three things: the taxonomy says so, the writers hash the identifiers they are given, and `tests/unit/audit.test.ts` scans **every `metadata: { … }` literal in `src/`** for `phoneE164`, `idNumber`, `accountNumber`, `detail` and `aboutTyped`. The scan asserts it found at least six literals first, so a rename that emptied it cannot make it pass while checking nothing.

`report.filed` therefore says a report was filed and what it was about. It does not say what was alleged and it names nobody. What is in a report is among the most sensitive things this product holds, and an audit log is exported, shipped and kept far longer than the row it describes.

### 9. Two things found on the way past

**Every export from a `'use server'` module is a callable endpoint.** The first draft of `review/actions.ts` exported a helper taking `(reportId, organiserId)` so the detail page could log an open — which is a public endpoint for writing an audit row in somebody else's name. It moved into the page itself, where the actor comes from the session rather than from an argument. A unit test now asserts that module exports exactly `startReading` and `closeReport`.

**`--muted-icon` is for icons.** The reference code on each queue row was set in it and measures 2.15:1 on paper — caught by axe, and it would have been caught by anybody reading a queue on a phone outdoors. It is `--ink-soft` now.

### 10. What the gate says

`pnpm typecheck && pnpm lint && pnpm test` green — 791 unit tests. Integration 298 across 19 files. E2E 135.

The E2E signs its reviewer in by **writing the session row and setting the cookie** rather than going through the OTP screens. `sign-in.spec.ts` is what proves signing in works; doing it again here would spend one of the three codes an hour a number is allowed, and this file's numbers are a fixed pool rather than random ones, so a second run inside the hour would fail on the rate limit rather than on anything the file is about.

### 11. What this does not do

- **No retention or export.** The log grows without bound and nothing prunes it. Architecture §11 gives events a twelve-month archive and a purge schedule; the audit log is not in it, and it holds hashed fingerprints rather than personal data, so it is not urgent — but "not urgent" is not "decided".
- **No alerting.** `admin.access.refused` is described above as the row worth alerting on and nothing alerts on it. There is no observability pipeline yet (architecture §13).
- **No queue for anything but reports.** The task says _"review queue for flagged events"_, and there are no flagged events by design — nothing flags, because nothing may (§4). Reported is the only thing an event can be, so reports are the queue.
- **No admin audit screen.** `auditForActor` exists and nothing renders it, so an admin cannot yet see what another admin read. The row is written; reading it is a query somebody runs by hand.

---

## M3-08 · Organiser dashboard

### 1. The money section is the whole task, and it is the part the design got wrong

`design/dashboard.html` renders _"Ready to pay out now — R44 600"_ above a **Request** button, under the line _"Money sits in a held Isipheko account until you ask for it."_

None of that is true. Mode B is Milestone 5 and gated on the legal opinion (architecture §15 item 1); under Mode A **the contributor pays the organiser directly**, so the money is already in her own account and there is nothing for us to release. Rendering it as a held balance would be the M1-08 §5 failure on the one screen where money is counted — and worse than usual there, because an organiser can act on it. She makes a promise, or buys something, on the strength of a number that describes money we never had.

So the split is computed for real and labelled for what it is. _"People pay you directly, so this money is already in your own account"_ is the first sentence in the section, before any figure. The three amounts are **Confirmed on the record**, **Still inside the 72 hours** and **Settled** — not _raised / settling / available_, because "available" is a word somebody acts on. There is no request button in `money.tsx` and a test asserts the page contains none at any state.

**The alternative was worse.** Gating the section behind `mode: 'hosted'` would have rendered it nowhere, since no event is hosted — dead UI behind a flag, which is how a section arrives in Milestone 5 having never been looked at.

### 2. `design/dashboard.html` now has three known-untrue elements

Recorded together so the next person reading that file for reference knows to check rather than copy. This is the M1-04 §1 shape — the prototype contradicting the rule the prototype exists to demonstrate — and it has now happened three times in one file.

| In the design                                                                    | Why it is not shipped                                                                            | What ships                                     |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| R1 test deposit for bank verification                                            | Part F: Stitch BAV checks the account against the holder's SA ID directly                        | Part F's replacement remedy, verbatim          |
| _"Saturday 15 August · KwaMashu · **in 4 days**"_ on the **bereavement** variant | Rule 1 forbids countdowns on bereavement, and `allowsCountdown` is the config field that says so | Date and place; no tail at any archetype today |
| _"Money sits in a held Isipheko account"_ + Request button                       | Mode B, not built                                                                                | §1 above                                       |

**The countdown is the serious one.** It is on the funeral variant specifically, in the file that is the visual source of truth, and somebody working from it would ship a countdown on a page about a burial without ever having decided to. A unit test scans every file under `src/app/(organiser)/manage/` for `in N days`, the word _countdown_, and _days to go_ — with comments stripped, so the explanation of the absence does not satisfy the check.

### 3. The hold fences the recent portion, and that is the whole of `splitBalance`

The done-criterion says _never the whole balance_, and the failure it names is concrete: a family who received one R50 contribution this morning must still be able to touch the R40 000 that arrived last week. A hold that froze everything whenever anything was recent is not a safety measure — it is a product that stops working on the day it is used most, discovered by somebody standing in a bank on the morning of a funeral.

Stated as a property in the tests rather than as one case: over twenty mixes, any set with at least one aged entry leaves something available.

Three things that came out of writing it:

- **The subtotals are plain `bigint`, not `Money`.** `Money` is a magnitude and `fromCents` throws on a negative — correct for an amount, wrong for a running subtotal that a reversal can take below zero on the way back up. An old credit reversed today is a recent debit against money that was never fenced, and the naive version throws a `MoneyError`, which on this screen is a 500 on the organiser's dashboard. The magnitudes are made once, at the end, from clamped values.
- **The window's edge is stated.** Exactly 72 hours old has served it. The alternative fences an amount for one further millisecond that nobody can act on and every test would have to reproduce.
- **`clearsAt` is the oldest fenced entry, not the newest.** What she is told is when she can act, which is when the first of them leaves.

In-kind entries are excluded from every figure. A tent is not money and cannot be paid out; counting it would inflate a number an organiser might act on, and it is already on the board and on the strand.

### 4. It reads the ledger, not `contributions`

A contribution row can be updated by the application; a ledger row cannot (rule 3). If the two ever disagreed, the number an organiser is shown should be the one nobody can quietly change.

It also means the figures move only when something is confirmed, which is the same event that writes the strand — one act, one moment, three places, no second definition of what counts.

`created_at` on the append is supplied by the application (M2-01 §3), so the three-day window is testable at a fixed instant rather than by the hour somebody runs the suite.

### 5. Four conditions, one button, and none that always passes

A condition that is true by construction is decoration. It teaches an organiser that the list is a formality, and the cost of that is paid on the one that matters rather than on the one that was decorative — so a unit test asserts that for each of the four there is a state in which it is unmet, and a fifth added later that cannot fail breaks it.

| Condition             | Unmet when                                    | Next step                                                                      |
| --------------------- | --------------------------------------------- | ------------------------------------------------------------------------------ |
| Name verified         | Before publishing                             | **A link to `/verify`**                                                        |
| Bank account verified | Always today — nothing writes `bank_accounts` | Part F's wording, plus _"you cannot do this yet — the check is not connected"_ |
| 72-hour hold          | Anything is inside the window                 | When it clears, and what is already past it                                    |
| An umkhaphi agrees    | Settled amount over R5 000                    | What the tap would do, plus that there is nothing to ask for                   |

**Identity is the one that looked like decoration and is not.** Publishing already requires verification (M3-02), so on a published event it is always true — but `/manage/[id]` is reachable for a **draft**, which is exactly when it is the thing standing in the way.

**The asymmetry is the honest shape.** A next step for an unbuilt flow is a sentence, not a control. A _Verify my bank account_ button opening a screen that cannot verify anything would be worse than the gap it hides — it converts a known absence into a bug report from somebody who trusted it. Where a remedy cannot be acted on, the copy says so in the same breath as saying what it will be, so nobody is left looking for a screen that does not exist.

`payoutReady` exists and nothing calls it from the UI. A set of conditions with no notion of "all of them" is a list rather than a gate, and M5 needs the gate; today the screen offers no way to act on it and a test asserts that.

### 6. The hold condition reads the fenced portion, not the total

Worth naming because the wrong version is the more natural sentence. If the condition were _"the whole balance has aged"_, an umcimbi receiving contributions every day would never satisfy it — permanently red on a working event, which is the same failure as fencing the whole balance wearing a different hat.

### 7. One queue, not two lists

The M2-05 stub had a card for payments and a card for deliveries. _"Confirm and mark-delivered are the two easiest actions on the page"_ is not satisfied by two lists: the second is below the first, and on a phone that means somebody with three tents waiting scrolls past six payments to reach them.

They interleave, oldest first — the same ordering the report queue uses (M3-07), for the same reason. What differs between the kinds is the tag, the button's words and whether there is a bank message to check against; not the shape of the row and not where it sits.

Both actions are plain `<form method="post">` server actions and an E2E test drives them with `javaScriptEnabled: false`. These are the two actions of her day, and a phone with a failed script bundle must not lose them.

The queue also carries a statement-shaped name — _"Look for R500,00 from **T NGCOBO** with reference MTH-4K7B2X"_. The whole Mode A confirmation model rests on her checking against her own banking app rather than trusting the screen, and a name she has to translate is a name she checks less carefully.

**And it says there is no unconfirm before the tap** rather than after it. A correction is a reversal entry (rule 3), which is a different thing from an undo, and the moment to learn that is not afterwards.

### 8. Suggestions had been built, tested and unreachable since M2-04

`suggestItem`, `approveSuggestion`, `declineSuggestion` and `suggestionsForOrganiser` all existed with integration tests and **no screen anywhere**. A contributor could tell a family they had forgotten the ice and no organiser could ever see it.

They are the fourth group on the board here. `design/dashboard.html` does not show them because the design predates the feature — which is a reason they are absent from the file, not a reason to leave them stranded.

The copy says a suggestion is _"not on your list until you say so, and not shown to anybody else until then"_, because the first question about somebody else's addition to your list is who else can see it.

### 9. The organiser's board is a different question from the public one

`boardForEvent` answers _what can still be taken_. `organiserBoard` answers _what do I still have to chase_, and the difference is the reason it exists: **an item fully claimed and undelivered is invisible on the public board**, and it is precisely the thing that does not arrive.

A partly-claimed item appears in **both** `open` and `promised`, deliberately. Sixteen of twenty kilograms of meat is simultaneously somebody's promise and a gap the family still has to fill; putting it in one list hides the other half, and the two need different actions — chase a person, or ask the group.

### 10. Two things found on the way past

**The theme wrapper ate the `<main>` landmark.** Replacing the old `<main>` with `<ArchetypeTheme>` left the page with no landmark at all — axe caught it, and a screen-reader user would have paid for it. The wrapper now sets `--accent` and nothing else, with `<main>` inside it doing the layout.

**`getByText` is a case-insensitive substring match.** Two `contribute.spec.ts` assertions broke because the reference now appears twice on the dashboard — on the row, and inside _"…with reference X"_ — and `getByText('Reference X')` matched both. Fixed with `{ exact: true }` rather than `.first()`, because which of the two is asserted on is the point.

### 11. What the gate says

`pnpm typecheck && pnpm lint && pnpm test` green — 850 unit tests. Integration 313 across 20 files. E2E 144.

`pnpm gate:size` unaffected: the dashboard is an App Router page on the organiser side and the 150KB budget is measured on `/e/[slug]`, which is still 35.9KB.

### 12. What this does not do

- **No payout, and no way to ask for one.** Mode B is Milestone 5. `payouts` and `bank_accounts` both exist and nothing writes to either; `src/db/repositories/payout.ts` contains no insert, deliberately.
- **No Stitch BAV.** The bank condition is unmet for everybody, forever, until that adapter is built. Part F decides the mechanism; nothing implements it.
- **No "send the list to the family group".** The design has the button and there is no BSP to send it with (Part J item 3). It would be a control that queues a message nobody receives, which is the same mistake as the payout button one notch smaller.
- **No undo on the queue.** The design offers Undo and Clear on a resolved row. There is no unconfirm by design (M2-05 §4) and a correction is a reversal entry — an Undo button would promise something the ledger does not do.
- **No countdown, ever, at any archetype.** Not only bereavement: nothing renders one, so `allowsCountdown` has no consumer yet. The field remains the thing a future countdown must ask.

---

## M4-01 · Messages and photos

### 1. `sharp` — the first runtime dependency since the scaffold, and why it was allowed

AVIF needs an AV1 encoder. There is no Node built-in, and there is no version of hand-rolling one. The alternatives were `@jsquash/*` (four wasm packages instead of one, materially slower), `@squoosh/lib` (unmaintained), and dropping AVIF from the done criteria — which would have been a spec change made to avoid a dependency rather than for a reason.

What settled it: **sharp is already an optional dependency of `next` itself**, for the image optimiser (`node_modules/next/package.json`, `"sharp": "^0.35.3"`). It is a package this stack expects, not a new vendor. It is server-side and native, so the public page pays nothing — `pnpm gate:size` still measures `/e/[slug]` at 35.9KB.

The parts that *can* be written without a codec are written without one. `src/domain/media/image.ts` does the magic-byte sniff and owns the key shapes; `src/domain/media/metadata-scan.ts` reads metadata out of four container formats. sharp appears in exactly one file, `src/adapters/media/sharp-image-processor.ts`, behind the `ImageProcessor` interface declared in `src/domain/media/` — the same inversion as the payment provider and the object store.

**What would make this wrong:** sharp's prebuilt binaries not covering a deployment target. There is a source build, but it wants libvips and a toolchain.

### 2. HEIC is refused, and refused *by name*

Prebuilt sharp carries no HEIC decoder — the HEVC patent position is why, and it is not going to change. Safari converts HEIC to JPEG on a form upload in the common case, so most iPhone photos arrive readable.

For the rest, the sniff returns `'heic'` rather than `'unknown'`, and it does so for one reason: *"that is an iPhone photo in a format we cannot read — send it through WhatsApp or Photos first, which turns it into a JPEG"* is something a person can act on. *"We could not read that file"* is not. Naming a format we refuse costs one branch and turns a dead end into an instruction.

### 3. The reader is independent of the encoder, or "EXIF confirmed stripped" means nothing

A test in which sharp encodes an image and sharp is then asked whether the metadata is gone proves that sharp agrees with itself. That is the whole of what most such tests prove.

So `scanImageMetadata` walks the containers by hand — JPEG segments to SOS, PNG chunks, RIFF chunks, ISO-BMFF boxes including `infe` item types — and `findGpsFix` parses the EXIF TIFF header and the GPS IFD, inline ASCII values and all. It shares no code with the encoder.

That buys the assertion that matters: `tests/unit/photo-stripping.test.ts` **first proves the fixture really carries the family's address** (−29.851, 31.019 — a house in KwaZulu-Natal) and only then proves nothing coming out of the pipeline does. Without the first half, a reader that always returned nothing would pass the second. `tests/unit/media-image.test.ts` holds the reader up against hand-assembled fixtures that do carry markers, so it cannot quietly become vacuous.

**All four derivatives are asserted, not just the primary one.** Full and thumb, AVIF and WebP. A stripped AVIF beside an unstripped WebP fallback is the entire protection lost to whichever format the browser picks — and the fallback is what an older phone gets, which is most of the phones this is for. There is a third assertion behind both: the strings `iPhone`, `Apple` and `Exif` must not appear anywhere in the output bytes, which catches a container the reader does not know about.

### 4. The original is never stored

Only the four re-encodes are written. Keeping the source "just in case" would keep the GPS with it, in a bucket, for as long as the bucket exists — which is exactly the outcome this task exists to prevent. An integration test reads the store directory and asserts it holds four files and no fifth.

The consequence to accept: there is no going back to a higher-quality original, and no re-deriving a size that was not produced at upload time. Adding a size later means re-uploading, and that is the right trade.

### 5. Orientation is applied before the metadata goes

`rotate()` with no argument bakes the EXIF orientation into the pixels. It has to run **before** the strip, or a photo taken sideways is stored sideways for good — the tag that told the browser how to turn it is no longer there to do it. Tested with an orientation-6 fixture, asserting the output's width and height have swapped.

A detail found on the way: sharp does not treat `Orientation` as an ordinary EXIF tag in `withExif` — it reads and rewrites it itself — so the test fixture sets it through `withMetadata({ orientation })` *after* `withExif`, which is the order that keeps both the GPS and the orientation.

### 6. Processed at the *who* step, carried forward as a signed ticket

The contribution row does not exist until the *pay* step — a reference code needs something to be unique against — and a file cannot ride in a hidden field. `design/contribute.html` puts the photo on the who step, which is the right place: it belongs beside the name and the message.

So the bytes are processed and stored the moment they arrive, and what travels is the digest. **The digest is signed**, HMAC over `(eventId, digest)` under `OTP_PEPPER`, modelled on the claim undo token in `src/domain/needs/undo.ts`. A bare digest in a hidden field would be a form anybody can edit: paste a digest recovered from another umcimbi's URL and the next submit attaches somebody else's photo to your contribution. The signature binds it to the event it was uploaded for; a ticket that does not verify is treated as *no photo*, not as an error, because the only way to hold one is to have edited the form.

**The cost, accepted:** photos uploaded by people who then wander off are orphaned. Most contributors who reach the who step never reach the pay step. `ObjectStore` has no `delete` and is not gaining one — the interface's lack of it is deliberate (M2-07), the keys are content-addressed, and tidying them is an operational job rather than an application call.

### 7. Two size limits, because one would cost a real contributor their typed name

`request.formData()` buffers the whole body, so a ceiling checked on `content-length` before reading is not optional once a step is multipart.

But a single ceiling forces a bad choice. Set it at the photo cap and a genuine 9MB phone photo is refused by a handler that never parsed the form and therefore cannot re-render the step with the amount, the name and the message intact. Set it high and the DoS is open.

So: **8MB for a photo**, refused after parsing with the whole flow's state preserved and copy that says the rest of what they typed is still there. **24MB for a body**, refused on the header with a 413 and never read. Between the two is where a real oversized photo lands, which is the case worth being careful about. Both are covered by E2E tests, the second by posting 25MB.

### 8. A photo on an anonymous contribution is allowed, and the conflict is stated

An anonymous contribution carrying a photo of a face is two settings fighting. Suppressing the photo silently would be a product overriding somebody's decision without telling them; refusing the combination would be worse.

It is allowed. The done step says so plainly — *"You chose to give quietly, and your photo still shows. Your name and what you gave are the parts that stay off the page."* — with no scolding and no undo button pretending there is a way back. It is her photo.

The warning is on the **done** step and not before it because the photo and the visibility are chosen in the same submit: with no JavaScript there is no moment earlier at which the two could be seen to disagree. The who step carries the same note once a photo is already attached, which happens on the error paths.

### 9. `<picture>` in the markup, not `Accept` negotiation

Each URL names exactly one representation: `<digest>-<size>.avif` and `<digest>-<size>.webp`. The choice is made by `<source type="image/avif">` in the markup.

Content negotiation on `Accept` would need `Vary: accept` on every image response, and a cache that ignores `Vary` — or normalises it — hands an AVIF to a browser that asked for the fallback. Two URLs cost nothing and are correct on every intermediary. The responses are `immutable` for a year, which is honest because the key is a hash of the bytes.

### 10. Two things found on the way past

**Hidden and visible fields with the same name were fighting.** The who step rendered `name`, `phone` and `message` as inputs *and*, on any re-render, as hidden carried fields. `FormData.get` returns the first, so the stale hidden copy won and an edit was silently dropped. Latent since M2-05 and nearly harmless while the only error path was a blank name; not harmless now that a rejected photo bounces people back to this step with everything else filled in. `Carried` takes an `except` list, and the three visible inputs are repopulated from `carried` rather than emptied.

**The queue thumbnail is the only place a photo renders for the organiser.** The album is M4-02. A picture of the tent that arrived is a reason to tap the confirm button, so it sits on the row above the ask — small, intrinsic height so a portrait photo is not cropped.

**"Bring something" would have swallowed a photo whole.** That route is `choose → item → who → done` — no pay step, and the pay step is what creates the contribution row. A file field on its who step would have taken somebody's photo, processed it, stored four derivatives and attached them to nothing, then shown *"Thank you"*. The field is not offered there, and the server refuses one on that route too, so a forged field cannot orphan an object either. `requiresPayment(route)` is the predicate in both places: today "reaches a pay step" and "creates a row" are the same question, and if they ever stop being, this is one of the callers to revisit.

### 11. Handover evidence is M4-01b, not this task

M2-11 §1 deferred the handover photo here and asked for a decision rather than a quiet widening. The decision is a follow-up task, recorded in the plan as **M4-01b**.

The instruction that mattered — *do not add a second stripping path* — is honoured: `acceptPhoto` is the one pipeline and it takes any `File` and an owning id. What M4-01b adds is a different **surface**: organiser-authenticated rather than contributor-facing, and it changes what a collection record claims about its own provenance. `src/copy/collection.ts` currently promises the photo *later*, and `tests/unit/handover.test.ts:140` asserts that promise — inverting an assertion about what a record says about itself deserves its own session and its own mutation checks, not a ride along with a contributor-side upload.

### 12. What this does not do

- **No album.** M4-02. A photo appears in exactly three places: the who step once attached, the done step, and the organiser's queue row. Nowhere on the public event page, which is why the size gate is unmoved.
- **No queue.** Processing is synchronous — 200–500ms of CPU bounded by an 8MB cap does not justify Redis and BullMQ, on the same reasoning as M1-06 §4 and M2-08 §1.
- **No S3.** The derivatives go to the same `LocalObjectStore` the OG cards use, and inherit its per-instance limitation. Architecture §15 item 6 has still not chosen a region. **This one is worse than the OG card's version of the same gap**: a missing OG card costs a redraw, and a missing photo is somebody's picture gone. It should be near the front of whatever list that decision gets made from.
- **No multiple photos, and no photo without a contribution.** One per contribution, and only through the flow.

---

## M4-02 · Album view

### 1. Two columns for photo dimensions, and the table they hint at

M4-01's processor computed a width and a height for every derivative and stored neither. The column was `photo_key` and nothing else.

Native lazy loading needs intrinsic dimensions or it does not work properly: four hundred images each arriving without a reserved box is the whole page shifting for as long as they take, on the connection this product is built for. The alternative was a fixed aspect box in CSS, which crops — and cropping somebody's photo of a gravestone to fit a 4:3 frame is not a trade this makes.

So `contributions.photo_width` and `photo_height`, nullable, written from the full derivative beside the key.

**The shape this raises, deliberately not built:** M4-01b's handover evidence will want the same pair on `collections`, and a third caller after that. At two owners a `photos` table is the right answer — key, dimensions, owner, one row per photo. Building it now, for one caller, would be a table with one row type and one foreign key. The hint is recorded here and in the schema so that whoever adds the second owner sees it rather than adding a second pair of columns.

Rows written before this migration have null dimensions and render inside a contained 4:3 box rather than a guessed one — a letterbox is a smaller wrong than a crop.

### 2. The dimensions are inside the ticket's signature

The photo is processed at the *who* step and the row is created at the *pay* step, so the dimensions have to cross a step boundary in a hidden field. `photoToken` now signs the whole claim — event, digest, width and height — rather than the digest alone, and the ticket is `<digest>.<width>x<height>.<token>`.

Editable dimensions would not be a security hole. They would be an editable layout: one entry given a 1×9999 photo pushes everything else off the page. There was no reason to leave it open, and signing what you are already signing costs nothing.

### 3. The cover and the entries come from one read of the chain

`albumForEvent` returns `{ beads, entries }`. Two queries — one for the strand, one for the list — could disagree by a row written between them, and the disagreement would be invisible in exactly the way that matters: a bead on the cover pointing at an anchor that is not on the page.

`strandForEvent` was left alone. It serves the public event page, which is the one under rule 9's ceiling, and this was not the task to touch it in. An integration test asserts the two agree, so the duplication cannot drift silently.

The bead carries an `amount` and the entry does not. That is not an oversight: a bead's *diameter* is banded by the amount (Part C.4) and never rendered, and **`AlbumEntry` has no amount field at all**, so the entries below the cover could not show one even by accident. A test asserts the field's absence rather than its nullness.

### 4. The album holds nothing the family has not confirmed — and the done screen now says so

A ledger entry exists only once the organiser has confirmed the payment against her own bank notification. Reading the chain therefore means somebody's message and photo appear when the family confirms, not when they are typed.

That is right — the album is the record, not the inbox — and it made an existing sentence untrue. The contribute flow's done screen said *"Your bead is on the strand. The family will see it when they open the page."* It is not on the strand, and they will not. It now reads *"Your contribution is with the family. It joins the record when they confirm it."*, and the photo caption changed from *"Your photo is on the record"* to *"Your photo joins the record with it."*

A screen claiming the record already holds you, when the record does not, is the same shape of dishonesty as the held-balance figure M3-08 had to overrule.

### 5. Link mode on the strand, and no motion on a record

On the event page a bead is a submit button in a `<form method="get">` — a server round-trip that works with no script, opening the one place that bead's words appear. On the album every entry is already further down the same page, so a round-trip would fetch content the reader can reach by scrolling and land them back at the top of a page they had started.

`hrefFor` turns each bead into an anchor. Same geometry, same `<ul>`, same accessible names; no form, no panels.

**And nothing settles.** The strand's one animated bead is the most recent arrival on a live page. Nothing has just arrived on a record, so link mode suppresses it at every archetype — including the ones that permit motion, which is where a missing check would have shown.

### 6. One shell for seven archetypes, asserted at all seven

There is no `if (archetype === …)` in the album. What changes is the accent, which is a CSS fallback (rule 2), and one archetype-keyed intro line — because *"Everyone who stood with the family"* and *"Everything that was brought and everything that was said"* are not the same sentence, and a single neutral line for both would be written for neither.

The tests run at every archetype rather than at the two the design files cover, and assert against the **visible text** rather than the markup: `width="2400"` is not the page saying 2400, and an assertion that cannot tell the difference is one that gets silenced by whoever trips it next. No amount, no count of contributions, no target, no progress, no countdown, nothing that moves.

A group bead's own *"5 people, one bead"* stays. That is what rule 14 requires a group to say about itself, and it is a fact about one entry rather than a tally of the event.

### 7. Almost all the album's words are borrowed

The heading over the entries is `archetypeEventCopy[…].strandHeading`. A quiet giver is `eventCopy.strand.quietly`. What somebody did is the strand's own phrasing, and `nameOf`/`whatOf`/`groupSize` are now exported from `src/ui/strand.tsx` against a `BeadSubject` shape that both `StrandBead` and `AlbumEntry` satisfy.

The album is the strand's record written out at length. A second set of strings for the same ideas is how a cover and its entries start saying different things about one event.

`src/copy/album.ts` holds only what the album alone says — including the link's wording. *"The whole record"*, not *"View album"*: album is a word the product invented for a thing that already has a name, and that link appears on a funeral page.

### 8. What it shares with the incwadi, and what it must not

The incwadi (M2-11) lists every member, every amount and a **total**, because a group handing over money in somebody's front room must account for it on paper. The album must never carry an amount or a total at any archetype.

One shared row component between them would put the one place a total belongs and the one place it must never appear in the same file. That is how a total eventually leaks into an album. They share the shell — tokens, `accentStyle`, `NotFoundPage` — and nothing structural.

What did get shared is a date. `formatDayMonthYear` moves to `src/lib/dates.ts`, where the incwadi had a private copy of it. Both are records read later — the incwadi is the paper a family keeps, and the album is what the record looks like in five years — and a date without a year is fine right up until it is the only date on the page. `formatDayMonth` stays as it is: a verification date is read today, against a decision somebody is making today.

The two "quiet giver" strings stay duplicated across `eventCopy.strand.quietly` and `collectionCopy.incwadi.quiet`. Merging one idea across two archetype-keyed copy files costs more than the duplication.

### 9. The album's budget is its own, and it was tightened on the first measurement

`pnpm gate:size` now measures `/e/[slug]/album` at four hundred entries. It measured **44.6KB** — 18.4KB of brotli'd document plus the latin font — so the budget was set to **50KB** rather than the 60KB it was provisionally given. Headroom nobody needs is headroom something grows into.

It is not rule 9's 150KB ceiling and should not be conflated with it. That number is for the page a stranger opens from a WhatsApp link before they have decided anything; this is a record opened deliberately by somebody who already knows the family, and it is four hundred entries long. Photos are outside the number because they lazy-load, one request at a time.

The event page went from 35.9KB to **36.0KB** — the album link — and the whole gate still passes.

### 10. Two things found on the way past

**A flaky unit test, made likelier by this task.** `tests/unit/domain-boundary.test.ts` paid the cost of ESLint's first `lintText` — the Next config, typescript-eslint, and the TypeScript project service — inside its first assertion, against a 5s timeout. Two new unit files competing for CPU pushed it over, and it passed when run alone. That is the worst kind of red: it teaches people to re-run rather than to look. The warm-up moved into `beforeAll` with its own timeout.

**The review queue truncates in silence, and that is now M3-07b.** Two E2E tests started failing against a local database that had accumulated 108 open reports: `reviewQueue` takes 100, ordered by the deadline somebody was promised, so the newest report — the one the test had just filed — fell off the end. The local data was cleared, and the test was **not** made resilient to the cap: a test that tolerates it would hide the thing worth knowing, which is that a reviewer scrolling to the bottom of that list believes they have seen everything. The SLA then fails invisibly on the one screen built to guarantee it.

**In-kind contributions can carry no message and no photo, and that is now M4-02b.** Somebody brings the tent — the most substantial thing anyone does, and the thing *ukupheka* names — and has nowhere to say anything. The album under-represents exactly that contribution. It is not a variation on the cash path: an in-kind row is created at *confirm* time inside `confirmDelivery`'s transaction, by the organiser, from a claim the contributor made days earlier, so the attachment point is not on the row's creation path at all. Recorded as a task with its shape rather than as a note.

### 11. What this does not do

- **No PDF.** M4-03, with real bleed and a queue.
- **No pagination, and none needed at four hundred.** The document is 18.4KB and the photos are lazy. Beyond that the density bands stop changing and the honest answer is a print, not a page two.
- **No amounts, ever, at any archetype.** Not behind a flag, not for the organiser, not on a variant. The organiser's own view of the money is the dashboard (M3-08), which is signed in and is a different artefact.
- **No album for a collection.** `/c/[slug]/incwadi` is the collection's artefact and stays its own.

---

## M4-03 · Print-ready PDF

### 1. `pdf-lib` and `@pdf-lib/fontkit`, and why not Chromium

Two dependencies, both pure JavaScript with no native binary and no browser.

The tempting alternative was printing M4-02's HTML through Chromium: one renderer for both artefacts, one stylesheet, no layout code. It was rejected because **it fails the criterion it would exist to satisfy** — Chromium writes no TrimBox and no BleedBox, and produces RGB with no way to declare it — and because a browser binary in production is a large operational commitment for a job that runs hourly.

`@react-pdf/renderer` brings its own layout engine and no bleed-box control. Writing a PDF writer with font subsetting is not a task, it is a library.

The image half needed nothing new. `sharp` was already installed for M4-01 and decodes AVIF and WebP, which is exactly what a PDF cannot embed.

**What would make this wrong:** pdf-lib is quiet upstream. It is unmaintained-adjacent rather than unmaintained, and the file it writes is a plain PDF that any tool can read — so the exposure is bounded to "no new features", not to "a format nobody else understands".

### 2. WOFF1 back to TrueType, rather than a third copy of the typeface

`pdf-lib` embeds `ttf` and `otf`. The site ships `woff2`, and `src/assets/fonts/` already holds two **WOFF1** files that M2-07 added for Satori.

WOFF1 is an sfnt with the tables individually zlib'd — no brotli, no glyph transform — so `node:zlib` undoes it in about seventy lines. The alternative was committing two more binaries in a third format, which M2-07's precedent would have covered.

The converter won on a property rather than on tidiness: **the printed album provably uses the same font file the site does**, not one converted somewhere else, at some point, by somebody. `tests/unit/woff-to-ttf.test.ts` asserts the output parses in fontkit — the same library that will embed it — with the same tables and the same glyphs.

### 3. What "passes a printer's preflight" was taken to mean

It cannot be run here. There is no Acrobat and no pdftoolbox, and a real preflight is a printer's own profile against the file at their counter.

So the criterion is **marked partially met in the plan**, the way M2-07 left WhatsApp rendering open, and `tests/unit/album-pdf.test.ts` asserts every structural property such a check looks at, against a really-generated document at one entry and at four hundred: three boxes on every page, 3mm bleed, fonts embedded and subset, no standard-14 font referenced, images as JPEG, no transparency, no soft masks, metadata.

**One known deviation is asserted rather than hidden.** A subset font is conventionally named `AAAAAA+PublicSans`; `pdf-lib` subsets the glyphs correctly and names the result `PublicSans-Regular-979`, with no tag. Some commercial preflights flag that. There is a test that the tag is *absent*, so that if a future pdf-lib starts emitting one, it fails and this note comes out.

**M4-03b exists for the rest**, and is deliberately not a task an agent can close: it needs a person, a print shop and a proof.

### 4. RGB throughout, said in words as well as in metadata

Three reasons, and the third is the one that decided it.

South African trade printers convert to their own profile as a matter of course. `--ink #16233D` is a specific navy, and a naive CMYK conversion without an ICC profile would not honour it. And body text built from four plates registers badly at this size and looks cheap — which is the opposite of what a keepsake is for.

So the file is RGB, the metadata says so, **and the colophon page says so in words**. A colour space discovered at the press is discovered too late, and not everybody opens the properties.

**What would make this wrong:** a printer who wants CMYK supplied. Then this becomes a per-shop option rather than a decision, and it needs a real profile rather than a formula.

### 5. A5 portrait, 3mm bleed, 16mm margins

A-series and millimetres are what the trade uses here, and A5 is the shape of a thing somebody keeps rather than files. Three millimetres is the trade default for bleed.

Sixteen millimetres of margin is generous — the usual safe zone is five — and generous is right for a record somebody reads slowly. Text crowding a cut edge reads as cheap.

### 6. The folio is the second legitimate exception to the no-count rule

*"3 / 12"* is a count of **pages**, not of people. The rule exists so a family is not ranked and amounts cannot be reverse-engineered (Part C.4, M4-02 §3); a folio touches neither, and a printed record without one cannot be reassembled after it is dropped.

This is the second such exception, and they are recorded together on purpose because somebody will eventually try to apply the rule too broadly. The first is M3-07b's: a count of **reports** on the review queue, which is a count of complaints rather than of contributions and is the thing that stops an SLA failing invisibly.

The test that guards the album's version of this rule asserts against the **visible text** rather than the markup, for the same reason M4-02's does.

### 7. Nothing that could carry an amount crosses the boundary

`PrintableEntry` has no amount field. `PrintableBead` carries a diameter, not a value: the amount is read to choose a band, the band chooses a diameter, and the diameter is what the renderer receives.

So "no amount in the printed album" is a property of the types rather than of anybody's care — which matters more here than on screen, because this is the artefact that gets printed and passed around and cannot be corrected after it is handed over.

### 8. Queued through the pattern that already exists

`pnpm render`, beside `pnpm notify` and `pnpm expire`. No Redis and no BullMQ: M1-06 §4 and M2-08 §1 both declined to add one and this task did not change the answer.

**Its own script rather than folded into `expire`.** Expire is fast, idempotent, and always takes about two seconds; this decodes and re-encodes every photograph in an album and can take minutes. A cron entry that sometimes runs long is a different operational animal from one that never does.

**A table rather than columns on `events`**, because a render has a state machine, a history of attempts, and more than one version over the life of an umcimbi. The row that matters when something is wrong is the one saying it failed three times, and columns would have overwritten it.

Claims are **conditional updates** — the same shape as claiming the last chair (M2-04) — so a slow run and the next hour's cannot render the same album between them. Three attempts, then `failed`, because a job retried forever fails forever in silence and burns a scheduled run each time.

### 9. Content-addressed, and what that buys on paper

The version is a hash of everything the album would draw. Asking twice for an unchanged record costs nothing — the second request finds the file that exists — and **a record that has grown mints a new version rather than replacing a file somebody has already printed from**.

That last property is the one that matters here rather than on a screen. A family who printed in August and again in October should be holding two different books at two different addresses, not one URL that changed underneath them.

Amounts are deliberately **not** in the hash: the album is identical whether somebody gave R50 or R5 000, and a version that moved on a number the album never prints would rebuild a file that is byte-for-byte what it already was.

The renderer takes `generatedAt` as an argument and reads no clock, so the same album really does produce the same bytes — asserted, because a content-addressed URL that changes on every generation is a URL claiming something it cannot keep.

### 10. The wait is stated, and the copy is bound to the schedule

There is no queue daemon. A render waits for the next run of `pnpm render`, and a spinner would be a lie with a moving part — so the dashboard says *"It is made by a job that runs every hour, so it will usually be ready within the hour."*

**That sentence is only true because of the cron entry.** If the schedule changes, `albumCopy.print.queued` changes with it. It is recorded here because the failure mode is silent: nobody notices copy that quietly stopped being true.

### 11. Four things moved so a scheduled job could reach them

`pnpm render` runs under `node --experimental-strip-types`, which resolves no tsconfig aliases and cannot compile JSX (docs/decisions.md M2-01 §8). Four things had to move, and each is better where it now is:

- **`nameOf`, `whatOf`, `groupSize`** — out of `src/ui/strand.tsx` and into `src/copy/strand-words.ts`. They are phrasing, and copy is where phrasing belongs (rule 11); a job that wanted three string functions was otherwise pulling a rendering component through a JSX transform.
- **`formatEventDate`** — out of `src/lib/event-card.ts` and into `src/lib/dates.ts`, beside the other two date formatters. `dates.ts` imports nothing at all, which is what makes it loadable from a job.
- **`src/adapters/pdf/`** and **`src/adapters/storage/`** — relative imports with explicit extensions, the pattern `src/adapters/messaging/` already followed for `pnpm notify`.

Type-only imports were left aliased throughout: `import type` is erased before Node sees it.

### 12. Two smaller things

**`Creator`, not `Producer`.** PDF means something specific by each: the Creator is the application the document came from, the Producer is the tool that wrote the PDF. That is Isipheko and pdf-lib respectively, and claiming otherwise would misname the one field a printer reads when they need to know what made a file.

**An entry is never split across a page break.** An entry is one person — their name, what they brought, what they said and their photograph — and a break through the middle puts a stranger's name at the foot of one page and their words on the next. The photograph shrinks instead; it is the one part of an entry that can give. An entry too tall for any page gets its own.

### 13. What this does not do

- **No crop marks and no registration marks.** A printer imposes their own, and marks we drew would be a second set to reconcile. The TrimBox is what tells them where the cut goes.
- **No CMYK, no ICC profile, no PDF/X conformance claim.** §4 and §3. Claiming PDF/X without being able to verify it would be worse than not claiming it.
- **No printed cover variant per archetype beyond the accent.** The accent band is the archetype's, and it is the print equivalent of `var(--accent, #16233D)` — bereavement declares none and gets indigo, with no branch anywhere (rule 2).
- **No pagination control for the organiser.** No page-size choice, no "photos only", no reordering. The record has an order and it is the order people came.
- **Nothing deletes an old render.** `ObjectStore` still has no `delete` and the app role holds no DELETE on `album_renders`. Old versions of a book stay reachable, which is the point of addressing them by content.

---

## M5-01 · Payment provider interface and simulator

### 1. Two interfaces, because PayFast's terms forbid one

`PaymentProvider` takes money in and reports that it arrived. `HeldBalanceProvider extends PaymentProvider` adds a balance held per beneficiary, a withdrawal against it, and the state of that withdrawal.

The split is not a modelling preference. PayFast's General Terms and Conditions 5.17 reads, verbatim:

> (v) an aggregated Payment Transaction is not made for multiple suppliers;
>
> (vi) a Payment Transaction is not submitted for or on behalf of third party (i.e. other business entities or an entity that has not signed an Affiliate form); and

A balance held for an organiser is what (vi) forbids. So `PayFastProvider` implements the narrow interface, and **assigning it where a `HeldBalanceProvider` is required is a compile error** — asserted by a `@ts-expect-error` in `tests/unit/payments-provider.test.ts`, which `pnpm typecheck` covers, so the day PayFast grows a `balanceFor` the build fails.

The alternative considered and rejected was one interface with three methods that throw on PayFast. That is the partial implementation the task said to refuse, and it converts something the compiler knows at build time into a runtime surprise on a payments path — the worst place in this product to discover anything. It would also read, to the next person, as an unimplemented feature rather than a contractual boundary.

**This entry exists so that the split survives the person who later wonders why there are two.** The answer is not tidiness. Merging them re-opens 5.17(vi).

### 2. `createDisbursement` did not cross over from architecture §5.1

§5.1 lists five methods shaped around Stitch: `verifyBankAccount`, `createPayIn`, `createDisbursement`, `getDisbursementStatus`, `verifyWebhookSignature`. Three of them describe instructing a credit transfer out of a float account we fund — which is the arrangement §0.2 flagged as closer to TPPP activity than we want, and the reason Milestone 5 was gated on a legal opinion in the first place.

Carrying them across would have meant somebody eventually implementing them. What replaced them is `requestWithdrawal` and `withdrawalState` against a balance **the provider holds and we never fund**, which is a materially different fact pattern and the one docs/paystack-analysis.md is asking a lawyer about.

`verifyBankAccount` is also absent. Onboarding a beneficiary has its own consent, its own evidence and its own review queue, and it is not something a payment interface should be able to do in passing. A `BeneficiaryReference` arrives here already opaque.

### 3. Nothing in the interface can carry a payer, or a clock

Two structural absences, both in the same spirit as M3-01 §3's _"nothing in the outcome types can carry an image"_.

**No payer.** `PayInRequest` has no name, no phone number, no email address, no message. An adapter has nowhere to put a contributor's details, so it cannot forward them without this file changing first (rule 4). A test asserts the PayFast form carries no `name_first`, `name_last`, `email_address` or `cell_number`, all four of which PayFast accepts and would happily have taken.

Where a vendor requires an address anyway — Paystack's initialize call does — the adapter derives an opaque, undeliverable one from the reference. That is a decision for the task that builds it; what this file guarantees is that it cannot be the contributor's.

**No timestamp.** No event carries one. Every rule in this product is computed against an application-supplied `now` — the ledger hash covers `created_at` (M2-01 §3), and the digest cap and the 72-hour hold read columns the application stamped (M2-08b, M3-08 §3). A provider's clock would make all three depend on somebody else's and untestable at a fixed instant, which is the failure the working agreement in CLAUDE.md exists to prevent. A test asserts no event field name matches `at$|date|time`.

### 4. PayFast's published ITN signature is not a test vector, and the sandbox settled it instead

The done-criteria asked for the signature to be pinned against PayFast's documented vector. **There is no such vector.** Their documentation shows an example ITN payload alongside the signature `ad8e7685c9522c24365d7ccea8cb3db7`; that signature does not verify against that payload under either of their two published algorithms, with or without the sandbox passphrase, with blank fields included or excluded, or under any plausible rendering of the three decimal fields. It is illustrative.

That mattered more than it sounds, because PayFast publishes **two** reference implementations that disagree with each other. PHP's `urlencode` escapes `` !'()*~ ``; JavaScript's `encodeURIComponent` leaves them. A surname with an apostrophe is enough to make the two produce different signatures, and O'Brien is not a rare payer.

So the question was settled against their server rather than their documentation. **`pnpm check:payfast`** posts a signed form to `sandbox.payfast.co.za/eng/process` and a corrupted one after it. PayFast **mints a payment page for ours** — `302` to `/eng/process/payment/<uuid>`, rendering `R 500.00` and the item name — and answers **`400 Bad Request`** to the corrupted one. PHP's `urlencode` is what their server agrees with, and the encoder follows it.

It is a command rather than a test because it makes a real request to a third party, and a gate that fails when the wifi does is a gate people learn to re-run rather than read.

**The incoming direction is still unconfirmed and the criterion is partially met.** An ITN is posted by PayFast to a publicly reachable `notify_url` after a _completed_ sandbox payment. Their own documentation says to use ngrok for this. It needs a public URL and a person, and no terminal can close it — the same posture as M2-07's WhatsApp device checklist and M4-03b's printer preflight. It is on Part J.

### 5. Three of PayFast's four security checks are in the adapter, and the fourth cannot be

PayFast documents four: verify the signature, check the notification came from a PayFast host, compare the amount to what was expected, and post the notification back to PayFast for confirmation.

One, two and four are in `PayFastProvider.verifyWebhook`. Three is `amountMatches` in `src/domain/payments/provider.ts`, and it is the caller's — for an ordering reason worth writing down. **You have to verify and parse a notification before you know which record it is about, and know which record it is about before you know what to compare the amount to.** An adapter given that responsibility would have to read the database, which puts a repository behind the payment interface and undoes rule 10.

Two smaller decisions inside those checks:

**The source is checked before the callback**, so a flood of forged notifications cannot make us call PayFast once per forgery. Asserted.

**`amountMatches` is exact, with no tolerance.** PayFast's own reference implementation allows a cent of drift because it compares floating-point decimals. This product has no floats anywhere (rule 7), so there is nothing to drift, and a tolerance would only widen what an attacker may substitute.

### 6. The incoming parameter string is never re-encoded

PayFast's reference implementations decode the posted body into a map and encode it again. That round trip only reproduces the original bytes if their encoder and ours agree on every character — which, per §4, theirs do not even agree with each other.

So the incoming direction takes the raw body and removes the `signature` pair from it, byte for byte, decoding nothing. Whatever PayFast encoded is what gets hashed, and the whole encoding question is unreachable in that direction.

**Exactly one `signature` pair, or the body is not an ITN.** PayFast's PHP reference stops at the signature, which truncates the body if it is ever not last — safe, but it would then fail every notification rather than one. Removing the pair wherever it sits survives a reordering; requiring there to be exactly one closes what that would otherwise open, which is a second `signature=` injected earlier for a verifier that reads the first it finds. Found by writing the test for "removes it wherever it is" and noticing what that permitted.

**The outgoing direction refuses to sign an ambiguous value.** We control every outgoing field, so a value containing one of `` !'()*~ `` is refused rather than guessed at. It costs nothing in practice — a merchant id, a reference like `MTH-4K7B2X`, an amount, an item name and URLs — and makes the ambiguity structurally unreachable rather than merely unlikely. The error names the field and never the value, because the value is payer data and the message reaches logs (rule 8).

### 7. MD5, said out loud

`payfast-signature.ts` hashes with MD5. It is PayFast's scheme, not ours: their server computes the signature they send, and a stronger hash on our side would simply not match. The file says so in its first paragraph, because an unexplained MD5 in a payments file reads as a lapse to every reviewer who finds it, and the next person should not have to work out whether it was a decision.

What makes an ITN safe is not the hash. It is all four checks: the notification must come from a PayFast host, carry a signature computed under a passphrase only PayFast and we hold, match an amount we were expecting, and survive PayFast being asked whether it is theirs.

Nothing else in the product uses MD5. The ledger chain is SHA-256 (M2-01), one-time codes are HMAC-SHA256 (M1-06 §3), and the simulator signs with HMAC-SHA256 because that one is ours to choose.

### 8. The simulator POSTs. It never calls a repository

The single most important property of `SimulatedPaymentProvider`: whatever a real provider would POST, it POSTs — over HTTP, to the `notifyUrl` it was given, signed, to be verified by the same `verifyWebhook` a real notification goes through.

A simulator that reached into a repository would leave the receiver route, the signature check and the handler seam untested, and those are the three things a payments integration actually gets wrong. The shortcut makes the tests green and the production path unexercised.

`tests/e2e/payments-simulator.spec.ts` is where that is proved, because it is the only place the POST actually leaves the process: money in, held for a beneficiary, a withdrawal requested, a withdrawal settled, with both notifications arriving through `/api/payments/simulator`. The unit test captures the POST and hands it straight back to `verifyWebhook`, which proves the loop closes and runs fast enough for every save.

### 9. Settling is two acts, not one

`requestWithdrawal` creates a **pending** withdrawal and posts nothing. `completeWithdrawal` is a separate control.

A simulator that completed synchronously would let a caller be written that never handles `pending` — and then the first real provider, whose settlement is asynchronous by construction, would break it. The asymmetry is the point of having a simulator at all.

**Held is reduced at the request, not at the settlement.** Otherwise two requests against one balance both pass their check and the second is caught only when it settles, by which time both were promised. Asserted.

**The nonce is idempotent and returns the same withdrawal.** Architecture §5.5: a retry carrying the same nonce is safe, and treating it as an error is how a timeout becomes a second payout.

### 10. `balanceFor` answers `null`, not zero

A beneficiary the provider has never held anything for is a different answer from one whose balance is R0,00, and only one of them should ever reach a screen as a number. A typo in a beneficiary reference that rendered as "R0,00" would be an organiser told, on the screen where money is counted, that nobody had given — which is the M1-08 §5 failure with an amount attached.

### 11. Three refusals stop the simulator reaching production, and they are not spares

1. `paymentProvider()` throws in production rather than returning the simulator.
2. `paymentEventHandler()` throws there too.
3. `/api/payments/simulator` and `/dev/payments` both `notFound()` there.

M2-05 §7 is firm that two application-level checks of the same condition are one check with a spare. These are not that: the factory refusals are construction-level and read the validated `env.NODE_ENV`, the route guards are route-level and read `process.env.NODE_ENV`, and they fail independently. `tests/unit/payments-factory.test.ts` proves each, and also proves both routes **serve** outside production — a route that 404'd unconditionally would pass the first three assertions.

The thing being guarded is a simulator crediting a real organiser's balance with money nobody paid, on the screen she makes promises against.

### 12. `/dev/payments` is the control surface; `/api/payments/simulator` is the receiver

Two routes, deliberately. The receiver is shaped exactly as a production one — raw body, signature, handler — and the tests must exercise it as such. The control surface is a set of buttons no production deployment has an equivalent of: _this payer paid_, _this one walked away_, _release this balance_, _the money landed_.

Mixing them would mean the receiver carrying an argument only a test ever sends, which is how a receiver stops being the thing that was tested.

The receiver is under `/api` rather than `/dev` because its shape is production's, and it 404s in production anyway. The controls are under `/dev`, beside `/dev/sms` and `/dev/tokens`.

### 13. `clientAddress` moved out of `src/lib/audit.ts`

The PayFast receiver needs the connecting address for the host check, and `audit.ts` imports the Prisma client. A route that touches no database was pulling in a database client to read a header — and it made the route untestable without a running Postgres, which is how it was found.

It is now `src/lib/client-address.ts` with the header-precedence reasoning attached to it, and `requestFingerprint` calls it. One rule, one place, two callers.

**The caveat travels with it.** `x-forwarded-for` is client-controlled, so the host check is only as good as the proxy in front of it — which is exactly why it is one of PayFast's four checks and not the whole of it. No header a sender chooses can make PayFast say a payment was theirs.

### 14. `payment_method` is left unset, and the task's "card and instant EFT" is not expressible

PayFast's `payment_method` field selects exactly **one** method and hides the rest. "These two and no others" cannot be said in the request. Sending `payment_method=cc` would have satisfied the letter of the task and shipped a checkout where nobody could pay by EFT.

So the field is omitted, every method the merchant account has enabled is offered, and **which methods are enabled is an account setting rather than a line of code**. Recorded here so that nobody later reads the omission as an oversight.

### 15. Optional environment variables, and a refusal at the point of use

`PAYFAST_MERCHANT_ID`, `PAYFAST_MERCHANT_KEY` and `PAYFAST_PASSPHRASE` are optional in `parseEnv`; `PAYFAST_MODE` defaults to `sandbox`. Requiring them in production would refuse to start a deployment that is not using PayFast at all, over a provider nothing calls yet. `payFastProvider()` throws instead, naming the variable that is missing. Same shape as `ADMIN_PHONE_NUMBERS` (M3-07 §2).

**The passphrase is required even though PayFast treats it as optional.** Without one the signature is a checksum over data the sender chose rather than a shared secret — the appearance of a security check and not one.

**`PAYFAST_MODE` is anything-but-`live` means sandbox**, never the other way round. Defaulting to live is how a test transaction reaches a real card.

### 16. Constructor parameter properties are not available here

`scripts/` runs under Node's `--experimental-strip-types`, which does not support them, so the adapters and `PaymentProviderError` declare their fields and assign in the constructor. Found by `pnpm check:payfast` failing to load the adapter it exists to exercise. Same family of constraint as M2-01 §8's relative imports with explicit extensions, and noted in the files themselves so the shape does not look like an accident.

### 17. `docs/decisions.md` joined `.prettierignore`

M1-01 §13 put the authored prose documents there because reflowing them produces a large diff that says nothing on the files most often read by a human. This one was left off the list, and nothing was failing because `pnpm lint` is ESLint only — but `pnpm format` would have rewrapped every paragraph in the longest prose document in the repository. Found by running Prettier over this entry and watching it reflow 21 paragraphs of M4-01 to M4-03 that nobody had touched.

### 18. What this does not do

- **Nothing is wired into the contribution flow.** No hosted mode, no tip, no copy changed, no collection touched. This is the seam and two implementations of it; the flows are M5-02 and after.
- **The handler records and credits nothing.** `RecordingEventHandler` appends the event to an array. Confirming a contribution and appending to the ledger is M5-03, and a handler that wrote to the chain now would be writing entries no flow can produce and no screen can read.
- **The simulator simulates no fees, no reversals, no settlement delay and no partial payment.** Each is a real behaviour with real copy consequences, and a half-simulated one teaches something false. They arrive with the flow that needs them.
- **No `releaseSettlement` on a real provider.** How a Paystack manual settlement is released is undocumented in both directions (docs/paystack-analysis.md §1.3) and is the first of the three written answers M5-00 is waiting on.
- **No ITN received from PayFast, ever.** §4. The receiver route exists, is tested against bodies we sign ourselves, and has never seen a real one.

---

## M5-02 · The hosted pay step

### 1. `events.mode` finally decides something, and two stand-ins hold it up

M1-02 shipped the column and M3-08 §1 noted that gating anything behind `mode: 'hosted'` would render it nowhere, because no event is hosted. One is now, and the flow branches on it: `ledger_only` shows the organiser's number and takes the contributor's word, `hosted` sends them to a checkout and the payment confirms itself.

**Two things are stand-ins and neither is a design.** They are here so the model can be walked end to end before the questions that gate a real provider have been answered (docs/paystack-analysis.md §6):

- **`mode` is flipped by SQL.** No screen sets it. A real one belongs with bank-account onboarding, because the moment an organiser is payable is the moment the event can be hosted — the two are one decision, not two.
- **The beneficiary reference is the organiser's id.** The simulator creates a balance for whatever it is handed, so this is enough to move money through the model. A real one is a provider's own beneficiary — a Paystack subaccount code — created from bank details that have been resolved, compared to a Home Affairs-verified name, and reviewed by a person before a first settlement (§1.4 of the analysis). That is M5-04.

`beneficiaryFor` is one function in the route, so replacing it is one function. Nothing else in the flow knows what a beneficiary is.

### 2. Every step before the pay step is identical, and so is the row

The reference, the photo claim, the rate limit and the row itself do not care which mode they are in. `startPayStep` is unchanged apart from its guard. What differs is one render and one branch on submit.

That is worth stating because the obvious alternative — a second flow for hosted events — would have meant two paths creating contributions, and M2-05 §2 already refused that shape once for claiming: two code paths reserving the same chair is how the last chair gets taken twice.

**`canReachPayStep` now answers for both modes**, in the domain, and the markup and the route both call it. Ledger-only needs the organiser's number; hosted needs somewhere to settle. Neither answer is "render a broken screen": each refusal has copy of its own, because *"the family has not added their number"* and *"the family has not finished setting up where contributions are paid"* are different facts with different remedies.

**No row is created when the step cannot be reached**, in either mode. M2-05 §7 found that the ledger-only version of this guard was untested because a second check in the page component hid it; the test there asserts no row is created, and the same property now has to hold for a checkout that cannot settle.

### 3. The contribution id travels in the return URL — and this is the third entry on tokens in URLs

M2-04 §3 put undo in a cookie and never in a URL. M2-11 §1 put a witness capability in one and explained why that was different. This is the third, and the three should be read together.

**What is in the URL:** a contribution id, on the return from the provider, as `?c=`. **What it can do:** nothing. The done step reads the photo, the visibility and the payment status off that row and writes nothing at all. It is scoped to the slug, so an id lifted from one umcimbi cannot be read through another's URL — without that, somebody's photograph would render on a page it does not belong to.

**Why it cannot be a cookie:** there is no cookie that survives a round trip through a provider on another origin. `SameSite=Lax` survives a top-level GET redirect back, but the flow has no session and the id has to be in the redirect the *provider* was handed, before any of this happens.

So the position across the three is: **a token in a URL is acceptable when it authorises nothing.** Undo changes state, so it is a cookie. A witness link acts once and is spent, so it is a single-use column with M2-11 §2's read/spend split. This reads one row that the person holding the link just created.

### 4. A provider that wants a form posted to it is refused, not half-built

`PayInRedirect` has two shapes because providers genuinely differ: a URL to follow, or a form to post. The simulator answers `follow`. PayFast answers `post`, and honouring it means a screen saying where somebody is about to be sent, in words somebody has reviewed against a real flow.

No such flow exists — PayFast is checkout-only and nothing routes to it — so the copy would be invented and unreviewable. The flow refuses instead, with `checkout-unavailable`: *"That payment page would not open, and nothing has been taken from you. Tell the family, and give the way you normally would."* It says what happened and what to do next, and it does not apologise.

Building it properly is about half a session, and belongs to the task that first has a `post` provider somebody can reach.

### 5. No reference on the hosted pay step

Mode A shows the reference because it **is** the mechanism: the contributor types it into a banking app and the organiser reconciles against it. Here nobody types anything. A code on screen with nothing to do with it invites somebody to think they have missed a step.

**One thing is lost and is worth naming.** M3-04's *"is this real?"* panel tells people to type `isipheko.co.za/check` and enter their code, and `/check` accepts a contribution reference (M3-05). A hosted contributor never sees one, so that route into `/check` is closed to them — the event's own code on the public page still works, which is the more useful lookup anyway. If it turns out people want their own, the done screen is where it goes.

### 6. The done step reads the row rather than assuming

The contributor returns through a redirect and the notification arrives on its own path. Usually it has landed first. Sometimes it has not.

So the screen says which: *"Your payment went through, and it is on the record"* when the row is confirmed, and *"Your payment is going through. It joins the record the moment it clears"* when it is not. Telling somebody their bead is on the strand before it is would be M4-02 §4's mistake again, on the screen where they are looking for exactly that.

**At M5-02 it always says the second one**, because nothing confirms a contribution yet — that is M5-03. The E2E asserts the clearing wording and M5-03 flips it, which is what makes the two commits reviewable in sequence rather than only together.

Mode A's two sentences are untouched and unreachable from a hosted event: *"The family will confirm it against their own bank notification"* describes a step that does not happen when the payment confirms itself. `done.hostedBody` is `done.body` without its tail — the same words where they are still true, and none where they are not.

### 7. `src/lib/payments.ts`, and the one `instanceof`

The wiring layer, beside `src/lib/notify.ts` and `src/lib/identity.ts`: the one place allowed to know both which provider is in use and what our routes are called.

`notifyUrlFor` is an `instanceof`, deliberately. Each provider has a receiver of its own — PayFast's four security checks are not the simulator's, and a shared route would have to work out who sent a body before it could verify it, which is backwards (M5-01 §12). The mapping has to live somewhere, and a `notifyPath` on the domain interface would have put a URL of ours inside a contract about money.

### 8. The control surface grew a checkout, and the tests found out why

`/dev/payments` listed every pay-in in the store with a Pay button each. A contributor arriving from the flow had to find their own row among everybody else's — and the first E2E run clicked a **disabled button belonging to a settled payment from an earlier test**.

A real provider's checkout shows one payment: the one you were sent to pay. So arriving with `?reference=` renders that payment and its two buttons above the tables. The tables stay, because the page is also where a developer inspects the whole store.

**The `back` field is checked against our own origin.** It is a URL the simulator was handed by a caller, echoed into a `Location` header, on a route anybody in development can post a form to. Dev-only is a reason to keep the habit rather than to drop it.

### 9. What this does not do

- **Nothing confirms a payment.** The notification reaches the receiver and the handler records it. The contribution stays pending, no ledger entry is written, and the organiser's dashboard shows nothing. That is M5-03, and it is the next commit.
- **No tip.** M5-07.
- **No screen sets `mode`, and none sets a beneficiary.** §1.
- **Nothing touches collections.** Rules 12, 13 and 16 are untouched, and the asymmetry a contributor may now notice — a card on an event page, none on a collection — is M5-12's sentence to write.

---

## M5-03 · The handler

### 1. Two entry points to the chain, and one append

`confirmContribution` is a person saying the money arrived in her account. `confirmByProvider` is a notification whose signature and origin an adapter has already checked. Different authority, different preconditions, different `verification_source` — and **the same append**, because two ways of writing to the ledger is two chances to write it differently.

M2-05 §7 warns against duplicating a guard across layers. This is not that: these are two callers of one mechanism, not one condition checked twice. What is shared is `appendEntryWithin` and the transaction shape around it; what differs is who is allowed to ask.

`verification_source` flips to `psp_webhook` at confirmation rather than at creation. The row exists from the moment the pay step is reached (M2-05 §3), which is before anybody knows how it will be paid — and the field is only meaningful once something is confirmed.

### 2. Idempotency in three places, and only two of them were observable

Every provider retries until it is acknowledged: PayFast for 72 hours, Paystack every three minutes and then hourly. **A replayed notification is the ordinary case, not an attack.** The ledger is append-only, so a duplicate is not something a later correction tidies away — it is two credits for one payment, permanently, and the only remedy is a reversal saying the record was wrong.

Three guards:

1. **The early return.** A row already carrying this payment id answers `already-recorded`, which is *not* a failure. Treating a retry as an error is how a provider's normal behaviour becomes an alert nobody can act on.
2. **The conditional update.** `where: { id, status: 'pending', pspPaymentId: null }`.
3. **The unique index** on `contributions.psp_payment_id`. The database, and it can be observed failing.

**The second one survived its first two mutation checks, and that is the part worth reading.** Removing the `where` clause broke nothing: every sequential path is caught by the early return or the status check, and the concurrent one is caught by the unique index — which turns the loser into a thrown constraint violation instead of a clean answer. A guard whose removal no test notices is precisely what M2-05 §7 names.

Two attempts at a race test did not fix it either, because two `confirmByProvider` calls in one process do not reliably interleave past the read.

So it is tested at the level it operates: a row that is **pending and already carries a payment id**. That state is not reachable through the application today — nothing records an id without confirming — and the test says so. The guard is there because **the read and the write are separate statements**: under read-committed the read is stale by the time the update runs, and the organiser confirming by hand in that window is a real sequence. Testing an unreachable state to cover a reachable risk is the honest shape here, and better than a clause nobody can prove does anything.

### 3. `now` is the application's, and there was nowhere for a provider's clock to get in

The hash covers `created_at` (M2-01 §3) and the 72-hour hold reads it (M3-08 §3). **No event in `src/domain/payments/` carries a time at all** (M5-01 §3), so the handler stamps the moment it wrote the row, which is the fact the ledger is actually asserting. The clock is injectable, so the integration tests assert an exact instant rather than a range.

### 4. A cancellation does nothing, deliberately

Somebody who backed out at the checkout changed their mind, which is the same as walking away from the pay step: the row stays pending and the fourteen-day sweep voids it (M2-05 §6).

Marking it void here would also make cancel-then-pay unrecoverable, and **no provider guarantees the order two notifications arrive in.** A void row that a later `charge.success` could not revive would lose a payment that actually happened.

### 5. A settled withdrawal does nothing yet

`payouts` is empty and nothing writes it (M3-08 §12). A debit on the chain against no payout row would be a movement the record cannot explain, and the ledger is the one place where "we will tidy it later" is not available. Recorded, not acted on, until M5-09.

### 6. The handler moved out of the adapter

`paymentEventHandler` was in `src/adapters/payments/` and refused in production, on the grounds that a receiver accepting a real notification and discarding it would be a contribution taken and never recorded. There is now something for a notification to do, so **the refusal is gone rather than kept as decoration** — M5-01 §11's three refusals are two.

Selection lives in `src/lib/payments.ts`, beside `notifyUrlFor` and `checkoutUrls`, because confirming a contribution means knowing about the database and `src/adapters/` has no business doing that. Outside production the recorder runs **first**, so `/api/payments/simulator` shows what the seam received including an event the ledger refused — an event that arrived and was rejected is exactly the thing a developer needs to see.

### 7. One sentence on the dashboard could not wait for M5-08

*"People pay you directly, so this money is already in your own account"* is false on a hosted event, on the screen where an organiser decides what to do with the money. That is the failure M3-08 §1 was written about, pointing the other way — there the design claimed we held money we did not, here the copy claims she holds money she does not.

So `money.intro` is keyed by mode and the hosted variant says where the money actually is: with the payment service, not with Isipheko, and not yet in her bank account.

**The rest of the section is still Mode A's, and one label is still wrong.** `available` reads *"Settled"*, which on a hosted event sounds like *in your bank* and means *past the reversal window*. Two different facts. The full rewrite is M5-08; this was the one sentence somebody could act on.

### 8. A hosted contribution never reaches the confirmation queue

The queue reads `self_reported_at`, which only *"I've paid"* sets, and a hosted contribution never passes through it. That is the mechanism M2-05 §3 built working without being asked to.

It matters more than it looks: a row she can confirm when it is already confirmed is a row she can be wrong about, and the whole value of that queue is that her yes means something. Asserted in the E2E rather than assumed.

### 9. What this does not do

- **No tip.** M5-07.
- **No payout.** `payoutReady` still has no caller and the payout section still says nothing can be requested, which is still true. M5-09.
- **No dispute or reversal handling.** A provider that reverses a settled payment needs a `reversal` entry and copy to explain it. M5-11.
- **No real beneficiary.** Still the organiser's id (M5-02 §1).
- **Nothing touches collections.** Rules 12, 13 and 16 unchanged.

### 10. The second untrue string, fixed after the fact

§7 said *"one label is still wrong"* and named `available`. There were **two**, and the other one was worse.

Under the confirmed figure, `raisedNote` read *"41 people's money, confirmed by you."* On a hosted event she confirmed nothing. The payment did, and §8 above is the reason she could not have: a hosted contribution never reaches the confirmation queue, so the screen was crediting her with checking something she never saw, in the note directly under the number she acts on.

It is now mode-keyed like the sentence above it — *"confirmed as each payment cleared"* — at both the singular and the plural, because those are separate strings and the singular is the one a small event reads. Asserted in `tests/unit/dashboard.test.tsx` beside the `intro` assertion.

**`available` is still *"Settled"* and is still M5-08's.** That one is a label meaning the wrong fact; this one was a sentence naming the wrong actor. Worth separating, because the audit that found the first missed the second — a mode sweep that reads the prose and stops at the figures will keep missing this class.

---

## M5-02b · The trust panel's money line

### 1. The panel had no mode to branch on, which is how it came to be false

`src/ui/public-page.tsx` renders the trust panel and knew nothing about
`events.mode`. `PublicEvent` did not carry it, `publicEventBySlug` did not select
it, and there was no branch anywhere on that page. So when M5-02 built a hosted
pay step reachable from the same page, *"Nothing on this page can take money from
you yet"* became false on a hosted event and there was no seam at which anybody
would have noticed.

**This is the fourth string of the class and the first on a public page.** The
three before it — `money.intro` (M5-03 §7), `money.raisedNote` (§10) and
`money.available`, still outstanding — are all on the organiser's dashboard,
where the reader is the person who set the page up and can check the claim
against her own bank. This one is read by a stranger, in the panel that exists to
be believed, one screen before the one that takes the money.

`PublicEvent` now carries `mode`, from the same column the pay step reads.

### 2. What the replacement says, and the two things it refuses to say

It says where the money goes — the family's own bank account, through a licensed
payment service — and that **Isipheko never holds it**. That is the promise the
old sentence was deferring: *"you will be told exactly where your money goes"*.
Saying it now rather than later is the whole fix.

**No timetable.** When a settlement reaches the family is unanswered
(docs/remaining-work.md A1, docs/paystack-analysis.md §1.3), and ZA settlement is
two working days rather than the T+1 the API documentation describes. A page
promising "within two days" would be inventing a number in front of the person
with the least ability to check it. A test asserts the absence on both variants,
because the pressure to reassure is exactly what put the original sentence there.

**No custody claim, in either direction.** The hosted variant does not say we
hold the money and does not say the organiser already has it — she does not, and
that is the mistake M5-03 §7 fixed one screen over.

### 3. The mutation check is a diff between the two renders

`changes nothing else on the page between the two modes` renders both and asserts
**exactly one chunk differs each way**. A branch on `mode` inside a page that
previously had none is an invitation to hang more off it — a second sentence, a
different badge, a hosted-only panel — and each of those is a divergence between
what two contributors see on pages that are otherwise the same umcimbi.

Proved by removing the branch: three tests fail, including that one.

### 4. `neverBody` is untouched, and must stay untouched

The prototype's version ends *"Money you send goes to a held Isipheko account for
this ceremony, never to a personal account."* That was untrue when M1-08 refused
it and it is **still untrue now that hosted mode exists** — funds sit with the
payment service, allocated to the family, and never with us. A hosted checkout is
the moment somebody will be tempted to restore it, because it finally sounds
plausible. It is not.

---

## M5-08 · The last untrue label on the money section

### 1. "Settled" is two facts, and only one of them is ever true today

On a ledger-only event *past the reversal window* and *the money is settled in
your account* are the same fact, because the contributor paid her directly. On a
hosted event they come apart: the money is with the payment service, nothing has
been paid out, and **"Settled" is heard as the half that is false** — under a
figure an organiser decides what to promise on.

The hosted label names the fact that is true and nothing else: **Past the
reversal window**, with a note saying where the money still is. It does not
invent a second figure, a fee line or a date.

**The second fact arrives with M5-10.** Settlement reconciliation is what first
makes *paid to your bank* true of anything, because `payouts` is empty and M5-03
§5 explains why it must stay that way until there is a payout row to explain a
debit. Adding a *"paid out"* label now would be a label for a state nothing can
produce.

### 2. `settlingNote` had the same word and was not on anybody's list

*"Everything older is settled."* Same ambiguity, one sentence lower, and it was
not named in M5-03 §7, in `docs/paystack-analysis.md` §3.1, or in
docs/remaining-work.md — all three of which name `available`. It says *"past that
window"* on a hosted event now.

**Four of the five strings in this block are keyed by mode.** They read one
`hosted` flag rather than four copies of `facts.mode === 'hosted'`, so a fifth
cannot quietly be added against a different fact than the other four.

### 3. The guard is about arrival, not about a word

`does not call money "settled"` is the direct assertion. The mutation check
beside it is broader: **no figure or note on either variant may say the money has
arrived anywhere.** That is the property, and "settled" was only one way to break
it.

It is scoped to the figures rather than the whole card, because the ledger-only
`intro` says the money **is** already in her own account — the one place in this
product where that is true, and the sentence M5-03 §7 keyed for exactly that
reason.

Both proved by mutation: unkeying the label fails one test; a hosted note reading
*"can no longer be reversed and is in your own account"* fails both.

### 4. Three strings, four passes, and this closes the dashboard

`money.intro` (M5-03 §7), `money.raisedNote` (M5-03 §10) and `money.available`
were all shipped as Mode A truths by M3-08 and all three were false the day
M5-02 built hosted mode. Each was found separately, by a person reading, months
apart. **Nothing on this screen is now known to be untrue in either mode** — and
M5-13 is the scan that stops the next one, written next and deliberately after
this.

---

## M5-13 · The scan that stops the sixth one

### 1. It scans the render, not `src/copy/`

The forbidden sentences are not forbidden. *"People pay you directly, so this
money is already in your own account"* is the plain truth of a ledger-only event
and must stay exactly as written. **What is forbidden is rendering one of them on
a hosted event**, which is what all five instances actually were.

So `tests/unit/hosted-claims.test.tsx` renders seven hosted surfaces — the public
event page, all five contribution steps, and the dashboard's money section — and
reads what a person would see. A source scan over the copy files would have to
permit every one of these strings to exist, which would leave it asserting
nothing.

The cost is that a surface nobody adds is a surface it cannot see, so
`covers the surfaces it claims to` pins the count.

### 2. Writing it caught two holes in itself, and that is the finding

The task was written **after** M5-02b and M5-08 deliberately, so the scan could
be authored against a codebase with all five instances fixed and then proved by
reintroducing each one. Two of the five were not caught by the first draft:

- **`available`'s *"Settled"* label** failed only the positive assertion at the
  bottom of the file — an incidental catch that would have evaporated the moment
  `availableNoteHosted` was reworded.
- **`settlingNote`'s *"Everything older is settled"* failed nothing at all.**

That is exactly the failure this file exists to prevent, in the file that exists
to prevent it. It was found by running the reintroduction rather than by trusting
the list of what to look for — which is the whole argument for proving a scan by
mutation instead of by reading it.

**All five now fail their own pattern**, each named in the test that catches it.

### 3. The settled pattern is scoped by subject, and the timetable one by money

Two false positives shaped these, and both are worth keeping in mind before
widening either.

**`board.intro` says *"3 of the 8 things on your list are settled"*** — a need
item that arrived, nothing to do with money. So the pattern matches a subject
list (*everything older*, *the rest*, *money*, *payment*, *amount*, *balance*)
rather than the word, and the needs board can join `SURFACES` later without a
rewrite.

**`event.trust.wrongBody` promises *"a person will look at it within one working
day"*** — M3-06's report SLA, a commitment about ourselves that we can keep. The
first draft of the timetable patterns matched it. Every pattern is money-scoped
now. The 72-hour hold is exempt for the same reason: a window in which a payment
can still be reversed is a fact about our own record, not about a bank's
timetable.

### 4. What it does not do

- **It does not run over collections.** `tests/unit/collection-page.test.tsx:110`
  already scans those for custody claims and M5-12 widens the money-path tripwire
  beside it. Two scans, two rules, no overlap.
- **It does not assert anything about a ledger-only event.** Those strings have
  their own tests, and duplicating them here would make this file fail for
  reasons that are not its subject.
- **It knows nothing about a provider.** Every surface renders from `mode`, so it
  keeps working unchanged when M5-04 replaces the simulator.

---

## OPS-09 · Object storage refuses in production, and a photograph is not a cache

### 1. The comment justifying the fallback outlived the thing it was about

`objectStore()` was the only one of six provider factories that did not throw in
production. It logged one warning and returned the local-disk store, and the
reason was written down in the file:

> Unlike `smsSender`, this does not throw in production: **a missing OG cache
> costs a redraw**, not a person waiting for a code that never comes.

That was correct when an OG card was the only thing in the store. **M4-01 put
contributor photographs in the same store and deliberately keeps no original** —
only the four re-encodes exist, because keeping the source would keep its GPS
with it (M4-01 §5). M4-03 then added album PDFs.

So the cost of the fallback stopped being a redraw. It became a photograph
somebody attached to a funeral: written to one container's disk, unreadable from
every other instance immediately, and gone on the next deploy — **weeks after**
the single warning line that was supposed to prevent it.

Nothing was wrong with the original decision. What was wrong is that a
justification aged into a hazard while still reading as reviewed, which is the
same failure shape as the four untrue copy strings and is why the doc comment now
carries the date the reasoning changed rather than only the reasoning.

### 2. The error says what the fallback would cost

The security-copy rule — copy explains what it protects, never only what it
blocks — applied to an error message an operator reads at three in the morning
during a deploy. *"No object storage is configured"* on its own invites the
quickest route back to a green deployment, and on this one the quickest route
loses somebody's photograph. So the message says that, and a test asserts it does.

### 3. The guard is a source assertion, deliberately

`warns nobody, because a warning was the bug` reads the adapter and asserts there
is no `console.warn` in it. A behavioural test cannot see the difference between
a throw and a throw with a warning restored beside it — and a warning beside a
refusal would pass every other assertion here while re-teaching the next reader
that carrying on is an option. That option is what this task removed.

### 4. `OBJECT_STORE_DIR` was the one variable the boot guard could not see

It was read from `process.env` and declared in no schema, so M1-01's guarantee —
*a missing or malformed value is a refusal to start, not a 500 on a contributor's
page later* — silently did not cover it. It is declared now, and **optional**:
the local store is never constructed in production, so requiring a path would
demand configuration for something that cannot exist.

**Optional is not the same as undeclared**, and the second test is the general
form: every `process.env.X` read anywhere under `src/` outside `env.ts` must be a
name the schema knows. There are three today — `DATABASE_URL`,
`NEXT_PUBLIC_APP_URL`, `OBJECT_STORE_DIR` — plus `NODE_ENV`, which every factory
takes as an argument and the schema declares anyway. A fourth added without a
declaration fails the suite.

---

## OPS-01 · The CI that rule 9 has claimed since M1-01

### 1. There was none, and two documents said there was

CLAUDE.md rule 9: *"CI fails the build on breach."* Part G restates it. There was
no CI, no Dockerfile and no deployment of any kind — `pnpm gate:size` was a
script somebody had to remember to run, and M3-02 §6 records two runs that
reported numbers from a stale build because nothing forced one.

A rule that names an enforcement mechanism that does not exist is worse than an
unenforced rule, because everybody downstream reads it as enforced.

### 2. Four jobs, split by what each needs rather than by tidiness

`check` needs nothing and answers in about a minute, so it is the one a
contributor watches. `integration` needs a container runtime, and Testcontainers
starts and mounts its own Postgres — including `prisma/init/01-app-role.sql`, so
the test database has the **two roles** without which
`tests/integration/ledger.test.ts` proves nothing about production. `e2e` and
`budget` each need a migrated database; `budget` additionally needs a production
build, which is the slowest step here and the reason it is not folded into `e2e`.

`e2e` and `budget` run `docker compose up -d --wait` against the same
`compose.yaml` a developer runs, rather than a service container with an
approximated setup. The two roles and the C locale are the point.

**The build happens on every `budget` run.** The gate measures whatever is in
`.next` and does not check that it is current, which is exactly how the stale
numbers happened. Its secrets are generated per run with `openssl rand`, because
the production schema refuses the published development keys by value (M1-02 §5).

### 3. Two things are deliberately absent, and one of them is a gap

**`pnpm check:payfast` is not a step and must not become one.** It posts a real
form to PayFast's sandbox. M5-01 §4 is explicit: *"a gate that fails when the
wifi does is a gate people learn to re-run rather than read."*

**`pnpm format:check` is not a step, and that is a gap rather than a decision.**
Twenty files, all from Milestone 4's album, photo and PDF work, are not
Prettier-clean. Adding the step today would fail every run until somebody pays
for a twenty-file reformat, and burying that reformat inside the commit that
introduces CI is the twelve-task diff nobody reviews. The four files this session
touched were formatted; the rest is named here and in docs/remaining-work.md so
it is a known debt rather than an unexplained absence in a workflow file.

### 4. Verified by running all four locally, not by reading the YAML

A CI that fails on its first run teaches people to ignore it. Before this was
committed: `pnpm typecheck && pnpm lint && pnpm test` (1149 unit), `pnpm
test:integration` (358 across 24 files), `pnpm test:e2e` (160), and `pnpm build`
followed by `pnpm gate:size` — which reports **36.0KB** first load against the
150KB ceiling and 0.63s LCP against 2.5s.

That last run mattered more than the others: OPS-09 had just made
`objectStore()` throw in production, and the gate runs a production server. It
passes because the album's lazy-loaded photographs are never fetched in the
measurement — but nothing about that was obvious from reading the change, and it
is the sort of thing a first CI run exists to find.

---

## M1-09 · The home page, and a 404 that costs six kilobytes instead of a hundred and seventy-five

### 1. What was there

`src/app/page.tsx` rendered `<main>Isipheko</main>` and carried a comment saying
not to grow it. Somebody typing the domain landed on the word and nothing else —
on **the only screen in the product a stranger reaches without a link**.

Two people arrive here and the page serves both without averaging them: somebody
deciding whether to set an umcimbi up, and **somebody who was sent a link they do
not trust and correctly refuses to use a number on it** (M3-04). The second is
why this page is load-bearing rather than marketing.

The custom comes before the product, because *isipheko* is from *ukupheka* and
in-kind is the reason the word is the name (CLAUDE.md). Somebody who reads only
the top must already know that bringing a thing counts the same as sending an
amount.

**Custody is stated, and the two answers differ.** On an umcimbi the money
reaches the family's own account; on a collection it goes to the organiser and
never touches us at all. The page gives both rather than the reassuring average,
which is rules 12 and 16 applied to the one page that describes both roles.

**32.0KB first load, zero scripts**, and `pnpm gate:size` measures it.

### 2. The one public route without `noindex`, asserted both ways

Architecture §10 puts `x-robots-tag: noindex` on every event and collection page
because a death in the family must not be findable on Google. That rule is about
pages naming a family. This page names nobody, and **a front door nobody can find
is not a front door**.

The gate asserts the absence here *and* the presence on `/c/[slug]` in the same
run, because the way this breaks is a later blanket header applied to everything
public — which would look like tightening security and would quietly delete the
only way anybody finds us.

### 3. Sign-in carries a destination, and it is an allowlist

Both calls to action land on `(organiser)` routes that redirect to `/sign-in`,
which had no return path: somebody who tapped *"Set up your umcimbi"* was dropped
at a phone-number field with no explanation and arrived after the code at an
account screen rather than at the thing they came for.

`next` now travels as a hidden field on both steps — the forms post to server
actions, which never see the query string, so a URL alone would lose it between
the number and the code.

**Four known destinations in a `Set`, and anything else is the default.** The
obvious shape is a check that the value starts with `/` and contains no `//`, and
every open redirect ever shipped passed a check like that. `signInDestination`
is tested against `//evil.example`, `/\evil.example`, a lookalike host, a
traversal, a query string and a trailing space.

Making the first creation step public was the alternative and is bigger. The
archetype choice stays inside the authenticated flow.

### 4. The 404 is a catch-all route handler, and the reason is 169 kilobytes

Next renders `not-found.tsx` as an App Router **page**. Measured on this build:
**1.7KB of document and eight scripts, 174.8KB transferred** — over rule 9's
ceiling, on the one screen whose entire audience is somebody on a prepaid bundle
holding a link they do not trust. Part G.1 measured the same 174KB and moved the
event page off a page because of it; this is the same measurement reaching the
same answer.

`src/app/[...path]/route.tsx` serves the same answer in **5.1KB with no script**.

**A root catch-all is a new pattern and it was asked about before it was built.**
It is only correct because Next resolves more specific segments first, which is a
framework guarantee this product now depends on and does not enforce. The failure
mode if that ever changes is silent and total: every umcimbi in existence
answering *"there is nothing at this address"*, which looks exactly like the scam
the page warns about.

So `tests/e2e/routes.spec.ts` walks **all thirty public addresses** and asserts
none fell through, and a fourth test reads the route table off the filesystem so
that adding a route without adding it to the walk fails.

**That test found its own false positive first.** Asserting on the response body
failed on `/sign-in`, which was serving the sign-in form perfectly well: **every
App Router page embeds its `not-found` boundary in the RSC flight payload**, so
the 404's title appears in the source of every page whether or not it rendered.
It reads the document `<title>` now — what a person would actually see.

`not-found.tsx` stays, because `notFound()` called from inside a page still
renders it — the four `/dev` screens and the simulator receiver, all in
production. Both read `homeCopy.notFound`, so the words cannot drift; only the
rendering differs, and each is right for its own constraint.

### 5. `no-html-link-for-pages` is off, everywhere

The catch-all made the rule resolve **every** path as a page, and it fired on
five files that had been correct for months — `check-page.tsx`,
`public-page.tsx`, `contribute-page.tsx` among them.

The rule assumes an App Router application whose routes are pages. This product's
entire public path is route handlers rendering static markup, `next/link` needs
the runtime those files exist to avoid, and pointing one at a route handler is
wrong besides. Disabled once in `eslint.config.mjs` with that reasoning, rather
than as five per-file directives that would each read as an exception.

---

## M3-07b · Review queue pagination

### 1. The SLA was failing invisibly on the screen built to guarantee it

`reviewQueue` took 100, ordered by the deadline somebody was promised, and the
screen said nothing about it. A reviewer who scrolled to the bottom of a
silently capped list believed they had seen everything.

**What fell off were the newest reports.** The order is by `respondBy` ascending,
so the rows past the cut are the ones whose deadline has not yet arrived — the
ones with the most time left to act on, and the ones a reviewer would most want
to see. The failure mode is not "some reports are late". It is "some reports are
never read, and nothing anywhere says so".

Found by two E2E tests failing against a local database that had accumulated 108
open reports. In production the cap is real and the failure mode is a person.

### 2. Paginated, and the count is stated whether or not there is more

`reviewQueue` returns `{ rows, total, offset, limit }` at fifty a page. The screen
says *"Showing 1 to 50 of 214 open reports"*, or *"All 12 open reports are on this
page"* when they fit.

**Both sentences, not only the first.** A list that announces its limit only when
it has one still ends silently on the day it does not, and the reviewer has no
way to tell which day they are looking at. This is the done-criterion — *no list
terminates without saying whether it is complete* — and it is a property of every
render rather than of the long ones.

A count here is a count of reports, not of contributions. It carries none of the
strand's or the album's rules (M4-03 §6, and M3-07b's note in the plan): it is
the number the SLA is measured against.

Paging is a plain `?from=` and plain `<a>` links, so the reviewer's screen holds
the same posture as the contributor's and works with JavaScript off.

### 3. The sort had to become a total order, and this is not theoretical

`respondBy` alone ties. The SLA is one working day, computed at insert, so every
report filed in the same window shares a deadline — **ties are the common case
here, not the edge.** Two rows that compare equal can come back in either order
from two queries, and under `skip`/`take` that is a report appearing on both
pages or on neither.

`createdAt` then `id` last makes the order total. Proved by mutation: removing
the `id` tiebreaker fails two integration tests, one of them the reachability
walk. Without it the bug this task exists to fix comes back in a subtler form —
a report that is not on any page rather than one past a cut.

### 4. Two things the tests found that were not the task

**The application role cannot delete a report.** The E2E fixture cleanup was
written as `deleteMany` and answered `permission denied for table reports` — the
reports migration issues `GRANT UPDATE` and `REVOKE DELETE, TRUNCATE`, because a
report is a record of somebody's accusation and the product cannot make one
vanish. The fixtures are **closed** instead, which is what a reviewer does, so
they leave the queue the way real reports do.

**The queue renders references, not free text.** The first version of the E2E
looked for a marker in `aboutTyped` and never found it: a list read at a glance,
over a shoulder, and screenshotted carries no detail (M3-07 §5). The marker is a
reference now, which is what the list actually shows.

### 5. The counts above the list and the list below it count different things

`queueReport.waiting` counts `received`; `reviewQueue` returns `received` **and**
`reviewing`. So the number at the top of the screen and the length of the list
below it can legitimately differ, and always have.

Left alone deliberately. *Waiting* means nobody has picked it up, which is the
number the SLA is about; the list is everything not yet decided, which is the
work. Making them agree would mean either dropping in-progress reports off the
screen or counting them as waiting, and both are worse than two honest numbers.
Recorded here because it looks like a bug on first reading and is not.

---

## M5-12 · The collections asymmetry, said plainly, and the tripwire widened

### 1. The question a contributor did not have until M5-02

M5-02 built a checkout on event pages. Once somebody has paid with a card on
one, *"why can't I do that here?"* is a question the collection page has to
answer — and **silence reads as a page that is broken rather than a page that is
honest**, on the one screen in the product whose entire job is being believed.

The asymmetry is real and correct, so it is explained rather than hidden. A card
on an event page settles to the family's own account through a licensed provider.
A card here would mean us collecting money to pass on to her — the activity rule
12 forbids, the question docs/paystack-analysis.md §0.2 puts to a lawyer, and the
thing that would put a private individual inside the card-scheme aggregation
clause in §1.8.

One sentence, in the custody panel beside `custodyTitle`, in the *protects*
voice: it says what the arrangement protects rather than what it blocks, and it
does not apologise or promise a later. A test asserts the absence of *sorry*,
*not supported* and *coming soon* — the three shapes this sentence would take if
somebody rewrote it as a missing feature.

`collection-page.test.tsx`'s custody scan passes unchanged, which was the
done-criterion. The pressure on it goes up the moment the event page can take
money, and that is exactly when it earns its keep.

### 2. The tripwire is widened before the temptation exists, not after

Giving a collection organiser a beneficiary so members can pay on her page is the
obvious next idea. `createCollectionSubaccount` is a plausible-sounding function
for somebody to write on the day this question is asked, and it would pass every
structural check the file had.

Added to both halves: `subaccount`, `paystack`, `payfast`, `split_code`,
`beneficiary`, `merchant`, `checkout`, `psp`. A provider's name is in the list
for the same reason rule 10 keeps one out of `src/domain/` — the first appearance
of `paystack` in a collection file is the moment this stopped being true.

**And a check on the seam rather than the vocabulary.** M5-01 put every payment
verb behind `PaymentProvider` and `HeldBalanceProvider`, so an import of either
from anything working with collections is the whole of rule 12 going, whatever
the function is called. A creative name gets past a word list; an import does
not.

### 3. The tripwire now trips itself, in the suite

M2-09 §7 verified the original by adding the forbidden thing and watching the
test fail — and that verification lived in a decisions entry rather than in the
suite. **A tripwire nobody has seen trip is a tripwire nobody knows is
connected.**

So it adds six columns to `collections` in turn — `subaccount_code`,
`beneficiary_reference`, `paystack_split_code`, `payout_account_id`,
`held_balance_cents`, `checkout_url` — asserts each is caught, and drops it again
in a `finally`. The names are the ones a migration would plausibly use.

Proved to matter rather than assumed: narrowing the pattern back to its
pre-M5-12 form fails on `subaccount_code`, which is precisely the column this
task was widened to catch.

### 4. Nothing else about collections changed

No payout, no beneficiary, no money path, no schema. Rules 12, 13, 14, 15 and 16
are untouched. `contributions.collection_id` is still unused by design (M2-10 §9)
and is now a live temptation with a column sitting there waiting for it — the
entry that explains why still stands, and this task is where it gets pointed at.

---

## M1-10 · The copy layer's leaks, and one claim that had stopped being true

### 1. The kickers moved, which M1-04 §7 said should happen when `src/copy/` landed

Seven isiZulu ceremony names — `Umshado`, `Umembeso`, `Umngcwabo`, `Umbuyiso`,
`Imbeleko`, `Umgidi`, `Itiye` — and every consequence sentence lived in
`src/domain/archetype/archetypes.ts`. The file said so, and had since M1-04:

> These are user-facing strings in `src/domain/`, which sits awkwardly against
> rule 11 … see docs/decisions.md M1-04 for where they go when `src/copy/` lands.

M1-04 §7 was more specific still: *"when `src/copy/` lands, they should move
there and the config should reference them — the flags stay, the sentences go."*
`src/copy/` landed at M2-05. They did not move.

**The cost is not tidiness.** `src/copy/` is the i18n translation unit (Part D),
so a string outside it is a string a translation pass never sees — and these are
the words a bereaved family reads first. `src/copy/archetype.ts` holds them now,
and it names the two that are open questions rather than settled words, because
it is the file somebody doing that review will open: **`Umgidi` for a graduation**,
which nothing in `docs/` justifies, and **`Itiye` for a gathering**, which two
prototypes call `Umhlangano`.

**The flags stayed.** `animate`, `allowsTarget` and `amountsPublic` are business
rules and are asserted to still be in the domain — a bereavement guard that had
to read the copy layer to know whether motion is allowed would be rule 1
depending on a translation.

### 2. The plan said two inlined strings. The scan found sixteen

Two were found by reading — `"Abakhaphi"` on the dashboard and `"Set up your
umcimbi"` on the account screen. `tests/unit/copy-layer.test.ts` found fourteen
more the moment it was written: four field labels and a card title on the new-
collection screen, two card titles and four toasts on the collection and
dashboard screens.

That ratio is the argument for the scan. Every one of the fourteen is a short,
unremarkable string on a plain screen, which is exactly the kind nobody notices
and a translator never receives.

The scan is narrow on purpose — JSX sentences, and `title` / `label` /
`placeholder` / `aria-label` attributes holding one. It does not try to catch
every possible inlined string; it catches the shape all sixteen had.

### 3. A comment said a sentence was not shipped. It had been for months

`share.ts` carried this from M2-07:

> The prototype's intro — *"Every person who opens it sees your verified name"* —
> is not shipped. Nothing is verified until M3-02 … The verified wording is kept
> below for the day it is true.

**M3-02 built the badge**, and `src/app/(organiser)/create/[id]/share/page.tsx`
has picked between `intro` and `introVerified` on `draft.organiserVerified` ever
since. The note was false, in the file somebody would open to check whether the
claim ships.

`setupCopy.share` carried a **third** copy of the same sentence — unconditional,
making the verified claim whether or not anybody was verified, and rendered
nowhere. It never lied to anybody because nothing read it; it was one import away
from doing so. Deleted, with the absence explained where it was.

### 4. A value import from `@/copy/` broke four scripts, and only the E2E saw it

`archetypes.ts` is reached by `scripts/render.ts` under plain Node with
`--experimental-strip-types`, where the `@/` alias does not resolve. The first
version imported `@/copy/archetype` and `pnpm render` died with
`ERR_MODULE_NOT_FOUND` — caught by `tests/e2e/album-pdf.spec.ts`, which shells
out to the real command, and by nothing else.

**A type-only `@/` import is fine and a value import is not**, which is why
`need-templates.ts` has got away with one for months. The import is relative with
an explicit extension now, and says why — the same constraint as M2-01 §8 and
M5-01 §16, reached from a third direction.

All four runners were then run for real: `pnpm render`, `pnpm notify`,
`pnpm expire` and `pnpm verify:ledger` — the last reporting 222 chains, 12 231
entries, none with problems.
