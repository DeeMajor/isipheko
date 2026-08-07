# Isipheko

A South African platform for **izimicimbi** — family ceremonies. Guests contribute money **or items** toward the cost of hosting, and the platform keeps an honest public record of who stood with the family.

Start with [CLAUDE.md](CLAUDE.md) for the rules that constrain every change, and [docs/architecture.md](docs/architecture.md) before touching the domain model, payments, or the ledger. The reference screens in [design/](design/) are the visual and copy source of truth.

---

## Setup

Node 22 or newer, and pnpm 11.

```bash
pnpm install
cp .env.example .env
pnpm dev
```

The app is on <http://localhost:3000>.

`cp .env.example .env` is listed for the habit rather than the necessity — in development every variable has a documented default, so a clean clone runs without it. That stops being true the moment you set `NODE_ENV=production`, where there are no defaults at all.

### Environment

Every variable is validated by [src/lib/env.ts](src/lib/env.ts) against a Zod schema. A missing or malformed value is a **refusal to start**, not a 500 on a contributor's page later. The guard sits on both paths:

| Path  | Where                                                         | Effect                                        |
| ----- | ------------------------------------------------------------- | --------------------------------------------- |
| Build | [next.config.ts](next.config.ts) imports `./src/lib/env`      | `pnpm build` exits 1, no artefact is produced |
| Boot  | [src/instrumentation.ts](src/instrumentation.ts) `register()` | process exits 1 before any request is served  |

`NEXT_PUBLIC_APP_URL` must carry an `http`/`https` scheme and no trailing slash. `URL.canParse` alone accepts `localhost:3000` and `postgres://…`, so a mispasted database URL would otherwise validate and produce share links nobody can open.

Errors name the offending variable and never print its value (CLAUDE.md rule 8).

---

## Scripts

| Script              | What it does                                                             |
| ------------------- | ------------------------------------------------------------------------ |
| `pnpm dev`          | Development server on :3000                                              |
| `pnpm build`        | Production build. Validates the environment first.                       |
| `pnpm start`        | Serve the production build                                               |
| `pnpm typecheck`    | `tsc --noEmit`                                                           |
| `pnpm lint`         | ESLint, including the `src/domain/` purity boundary                      |
| `pnpm lint:fix`     | ESLint with `--fix`                                                      |
| `pnpm format`       | Prettier write                                                           |
| `pnpm format:check` | Prettier check, for CI                                                   |
| `pnpm test`         | Vitest unit suite. **Vitest only** — fast enough to run on every change. |
| `pnpm test:watch`   | Vitest in watch mode                                                     |
| `pnpm test:e2e`     | Playwright. Starts its own dev server.                                   |

The gate before any commit:

```bash
pnpm typecheck && pnpm lint && pnpm test
```

Playwright needs its browser once:

```bash
pnpm exec playwright install chromium
```

---

## Toolchain pins

Three pins are deliberate and will look wrong to anyone reaching for the newest version. Reasoning in full in [docs/decisions.md](docs/decisions.md).

- **TypeScript `^6`, not 7.** typescript-eslint 8.66 hard-throws on TS 7.0 — _"does not support TS 7.0"_ — which also takes down `eslint-config-next`. Lint is where the domain boundary is enforced, so losing it is not an acceptable trade for a compiler version.
- **ESLint `^9`, not 10.** `eslint-plugin-react` 7.37.5, pulled in by `eslint-config-next` 16, calls `context.getFilename`, removed in ESLint 10.
- **pnpm 11.20.0**, pinned via `packageManager`.

Both pins are removable once the upstream packages catch up; check before assuming they still apply.

TypeScript strictness goes beyond `strict` — see [tsconfig.json](tsconfig.json). `exactOptionalPropertyTypes` is load-bearing rather than fastidious: it is what makes `{ animate: undefined }` a different type from `{}`, and an absent `accent?` meaningfully different from a present one. CLAUDE.md rules 1 and 2 depend on that distinction holding.

---

## Working on a slow or metered connection

This is a South African product and some of the people building it are on the same connections the contributors are. [.npmrc](.npmrc) sets `network-concurrency=4` with long retries — the default of 16 parallel fetches makes a lossy link considerably worse, not better.

If an install hangs before transferring anything, it is almost certainly IPv6. Where DNS returns AAAA records for `registry.npmjs.org` but v6 egress is broken, Node prefers the dead route and waits:

```bash
export NODE_OPTIONS="--dns-result-order=ipv4first"
```

---

## Layout

```
src/
  app/          routes; (public)/e/[slug] is performance-critical; /check is the independent verification route
  domain/       pure business logic — no I/O, no framework, no Prisma. ESLint enforces it.
  adapters/     payments, identity, messaging, storage
  db/           Prisma client and repositories
  ui/           primitives, patterns, tokens.css
  copy/         typed copy, keyed by archetype
  lib/
tests/
  unit/         Vitest
  e2e/          Playwright
design/         reference screens — visual and copy source of truth
docs/           architecture, decisions, design system, copy
```

The public event page has a hard **150KB** budget (CLAUDE.md rule 9). Server components by default.
