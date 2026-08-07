# Isipheko

A South African platform for **izimicimbi** — family ceremonies. Guests contribute money **or items** toward the cost of hosting, and the platform keeps an honest public record of who stood with the family.

Start with [CLAUDE.md](CLAUDE.md) for the rules that constrain every change, and [docs/architecture.md](docs/architecture.md) before touching the domain model, payments, or the ledger. The reference screens in [design/](design/) are the visual and copy source of truth.

---

## Setup

Node 22 or newer, pnpm 11, and a container runtime for Postgres.

```bash
pnpm install
cp .env.example .env
pnpm db:up          # Postgres on :5433
pnpm db:deploy      # apply migrations
pnpm dev
```

The app is on <http://localhost:3000>.

`cp .env.example .env` is listed for the habit rather than the necessity — in development every variable has a documented default, so a clean clone runs without it. That stops being true the moment you set `NODE_ENV=production`, where there are no defaults at all.

### Podman, not Docker

This was built on Fedora with **Podman 5**, and `pnpm db:up` runs `podman compose`. Two things follow, both of which cost an hour if you meet them without warning:

- **Testcontainers needs a Docker-compatible socket.** Enable it once per machine:

  ```bash
  systemctl --user enable --now podman.socket
  ```

  [tests/setup/postgres.ts](tests/setup/postgres.ts) finds it automatically at `/run/user/$UID/podman/podman.sock` and disables Ryuk, Testcontainers' cleanup sidecar, which rootless Podman cannot run. An explicit `DOCKER_HOST` always wins, so a real Docker host is unaffected.

- **SELinux blocks the init script mount.** [compose.yaml](compose.yaml) marks it `:ro,z`. Without the `z`, Postgres exits during initialisation with `Permission denied` on a file that is plainly present and world-readable. Docker understands the flag too, so it costs nothing elsewhere.

On a Docker host, `docker compose up -d` works against the same [compose.yaml](compose.yaml); only the `db:*` scripts name Podman.

### Environment

Every variable is validated by [src/lib/env.ts](src/lib/env.ts) against a Zod schema. A missing or malformed value is a **refusal to start**, not a 500 on a contributor's page later. The guard sits on both paths:

| Path  | Where                                                         | Effect                                        |
| ----- | ------------------------------------------------------------- | --------------------------------------------- |
| Build | [next.config.ts](next.config.ts) imports `./src/lib/env`      | `pnpm build` exits 1, no artefact is produced |
| Boot  | [src/instrumentation.ts](src/instrumentation.ts) `register()` | process exits 1 before any request is served  |

The boot half ends the process explicitly rather than throwing. Throwing is not enough: Next catches it, logs an `unhandledRejection`, and keeps listening — answering every request with a 500. A container in that state passes a TCP health check and stays in the load balancer.

`NEXT_PUBLIC_APP_URL` must carry an `http`/`https` scheme and no trailing slash. `URL.canParse` alone accepts `localhost:3000` and `postgres://…`, so a mispasted database URL would otherwise validate and produce share links nobody can open.

Errors name the offending variable and never print its value (CLAUDE.md rule 8).

---

## The database has two roles, and the difference is load-bearing

| Role             | Used by                                 | Rights                                                   |
| ---------------- | --------------------------------------- | -------------------------------------------------------- |
| `isipheko_owner` | migrations, via `prisma.config.ts`      | owns the schema, full DDL                                |
| `isipheko_app`   | the application, via `src/db/client.ts` | `SELECT`, `INSERT`; `UPDATE`/`DELETE` only where granted |

`ledger_entries` and `audit_log` grant the application role **`SELECT` and `INSERT` only**. That is CLAUDE.md rule 3 — the ledger is append-only, corrections are new `reversal` entries — expressed as something Postgres enforces rather than something the code remembers. The claim made to users is _"nobody, including us, can quietly change this record"_, and a convention in a repository does not support that claim.

Revoking from the owner would be theatre: an owner keeps implicit rights over its own tables. The guarantee only exists because there is a second role.

**Do not point `DATABASE_URL` at the owner role to make something work locally.** It will work, every test will still pass, and the ledger will be silently rewritable.

New tables arrive with `SELECT` and `INSERT` and nothing more — [the migration](prisma/migrations/20260807235900_constraints_and_grants/migration.sql) sets `ALTER DEFAULT PRIVILEGES` that way and names the mutable tables one at a time. A table that needs `UPDATE` says so in a line a reviewer can see.

### Constraints live in migration SQL

Three things are not expressible in `schema.prisma` and are written by hand in [20260807235900_constraints_and_grants](prisma/migrations/20260807235900_constraints_and_grants/migration.sql):

- the bereavement CHECK — a funeral cannot carry a target (rule 1)
- the archetype/group agreement CHECK — the denormalised group column cannot drift from its key
- the ledger privileges above (rule 3)

If a future `prisma migrate dev` offers to drop any of them, the answer is no.

### Key material

`BANK_ACCOUNT_ENCRYPTION_KEY` and `ID_NUMBER_PEPPER` are 32 bytes of base64 (`openssl rand -base64 32`). Bank account numbers are AES-256-GCM encrypted per column; ID numbers are hashed with the pepper and never stored in plaintext.

**Both are held in the environment as a stopgap.** Architecture §10 and §7.3 put them in a KMS, separate from the database credential, and that is where they belong before anything real is stored. Everything goes through the [`ColumnCipher`](src/domain/crypto/column-cipher.ts) interface so the move costs one file. The development values are published in `.env.example`; production refuses to start if it finds either of them.

---

## Scripts

| Script                                | What it does                                              |
| ------------------------------------- | --------------------------------------------------------- |
| `pnpm dev`                            | Development server on :3000                               |
| `pnpm build`                          | Production build. Validates the environment first.        |
| `pnpm start`                          | Serve the production build                                |
| `pnpm typecheck`                      | `tsc --noEmit`                                            |
| `pnpm lint`                           | ESLint, including the `src/domain/` purity boundary       |
| `pnpm lint:fix`                       | ESLint with `--fix`                                       |
| `pnpm format`                         | Prettier write                                            |
| `pnpm format:check`                   | Prettier check, for CI                                    |
| `pnpm test`                           | Unit tests only. Fast — runnable on every save.           |
| `pnpm test:watch`                     | Unit tests in watch mode                                  |
| `pnpm test:integration`               | Real Postgres in a container. **Not run by `pnpm test`.** |
| `pnpm test:all`                       | Both projects                                             |
| `pnpm test:e2e`                       | Playwright. Starts its own dev server.                    |
| `pnpm db:up` / `db:down` / `db:reset` | Postgres via `podman compose`                             |
| `pnpm db:migrate`                     | Create and apply a migration (`prisma migrate dev`)       |
| `pnpm db:deploy`                      | Apply committed migrations (`prisma migrate deploy`)      |
| `pnpm db:generate`                    | Regenerate the Prisma client. Runs on `postinstall`.      |
| `pnpm db:studio`                      | Prisma Studio                                             |

### A green `pnpm test` is not a green build

`pnpm test` runs unit tests only, because a gate that takes a minute is a gate people stop running. The cost is that the checks most worth having are the ones it skips.

The integration project is what proves the bereavement CHECK rejects a target on a funeral, that the application role cannot rewrite the ledger, and that no collection has a money path. Those guard a funeral page and the trust artefact. They are also, precisely because they are slower, the ones a hurried run leaves out.

**Before pushing, run `pnpm test:all`.** CI runs both and neither is optional there.

The gate after every task:

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
