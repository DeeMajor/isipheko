# Isipheko — Agent Instructions

Read this file at the start of every session. Read `docs/architecture.md` before any task touching the domain model, payments, or the ledger. The five reference screens in `design/` are the visual and copy source of truth.

---

## What this is

Isipheko is a South African platform for **izimicimbi** — family ceremonies. Weddings, funerals, unveilings, imbeleko, graduations. Guests contribute money **or items** (a tent, chairs, 20kg of meat) toward the cost of hosting, and the platform keeps an honest public record of who stood with the family.

*Isipheko* comes from *ukupheka*, to cook. The custom is originally about bringing provisions, not cash. In-kind contribution is not a secondary feature — it is the core of what the word means.

## Who uses it

There are **two distinct organiser roles**. Do not collapse them — a person may be a host on one event and a collection organiser on another.

- **Host** — running the umcimbi, receives via payout. Often a daughter in Johannesburg arranging an event for family in KwaZulu-Natal. Phone OTP auth. Verified against Home Affairs before publishing.
- **Collection organiser** — a *guest* who rallies a group (cousins, colleagues, a congregation) and hands over one collective contribution. **She holds the money in her own account. We never touch it and neither does the host.**
- **Contributor** — an aunt, a neighbour, a church member. **Never has an account.** Arrives from a WhatsApp link, possibly on a borrowed phone, possibly with very little data left.
- **Witness (umkhaphi)** — publicly vouches. On events, approves payouts. On collections, confirms handover.

---

## Non-negotiable rules

**1. Bereavement events have no targets, no progress bars, no countdowns, no celebratory motion.**
Enforced at three layers: a database CHECK constraint, the type system, and a runtime render guard. `animate` must be explicitly `false`, never merely absent. If a task seems to require loosening any of this, stop and ask. Getting it wrong on a real funeral is not recoverable.

**2. The archetype accent is a CSS fallback, not a conditional.**
Every accent usage is `var(--accent, #16233D)`. Bereavement declares no accent and therefore renders indigo automatically. Never write `if (archetype === 'funeral')` to achieve this.

**3. The ledger is append-only.**
Never `UPDATE` or `DELETE` a `ledger_entries` row — the app database role lacks those grants. Corrections are new `reversal` entries. Each row hashes the previous row; breaking the chain is a critical failure.

**4. Contributors never authenticate.**
Any design requiring a contributor account, login, password or email is wrong. Reject it and say why.

**5. Claiming is never optimistic.**
`idle → pending → claimed | conflict`. Server round-trip, `POST /api/claim`, conditional update, 409 on conflict. Must also work with JavaScript disabled via `<form method="post">`. Two people tapping "I'll bring the tent" at the same moment must not both see success.

**6. `src/domain/` is pure.**
No imports from `app/`, `adapters/`, or `db/`. No I/O, no framework, no Prisma types. ESLint enforces it. This is what makes the payment provider swappable.

**7. Money is integer cents in ZAR.**
Use the `Money` type. Never a float. Format as `R1 234,56` — space thousands separator, comma decimal.

**8. Never log or store personal information in plaintext.**
ID numbers hashed with a KMS-held pepper. Bank account numbers column-encrypted. Selfies and Home Affairs photos never persisted. Scrub PII from logs using an allowlist, not a denylist.

**9. The public event page has a hard 150KB budget.**
CI fails the build on breach. South African mobile data is expensive; every kilobyte is friction between a family and a contribution. Server components by default.

**10. Payment code lives behind the `PaymentProvider` interface.**
No domain or UI code imports Stitch types. The regulatory position is unresolved and the provider may change.

**11. Copy lives in `src/copy/`, keyed by archetype.**
Never inline user-facing strings in components. This structure is also the i18n translation unit.

**12. A collection has no payout, no float, no disbursement.**
The collection organiser holds the money in her own account. There is no money path through us. Any code adding one is wrong — stop and ask.

**13. On collections, verification gates *sharing*, not payout.**
We never hold the money, so there is no payout to withhold. No verified identity means no shareable link. That is the only point of leverage that exists.

**14. A collection is one ledger entry, never one per member.**
On the host's event page it appears as a single group bead — *"The Ngcobo cousins — R5 000"* — opening to reveal members.

**15. The host does nothing in the system during a handover.**
Handover is confirmed by a witness (default) or by the organiser with evidence. An optional one-tap host acknowledgement by SMS exists but must never be required.

**16. Collection copy must state plainly that the organiser holds the money, not Isipheko.**
The contributors are trusting her. Implying otherwise would be the one dishonest thing in an otherwise honest product.

---

## Working agreement

**Before writing code**, restate the task and list the files you intend to create or modify. Wait for confirmation.

**Ask, don't assume.** An assumption baked into code costs far more than a question.

**No new dependency without asking.** Every package is a bundle-size and supply-chain decision.

**No new architectural pattern without asking.**

**Tests in the same session as the code.** Not later.

**Never mock the ledger or the database in integration tests.** Use Testcontainers.

**Any timestamp a rule is computed against must be supplied by the application, not defaulted by the column.** The database default stays for anything bypassing the repository, but a rule that reads a wall-clock column cannot be tested against a simulated one — the test then passes or fails according to the hour somebody runs it, and a clock-dependent suite teaches people to ignore red. Two instances so far: the ledger hash covers `created_at` (M2-01 §3), and the digest cap and retention window read `notifications.created_at` (M2-08b).

**After each task:** run `pnpm typecheck && pnpm lint && pnpm test`, then append anything decided beyond the spec to `docs/decisions.md`.

**Commit format:** `feat(M2-04): needs board claiming with expiry`

---

## Stack

Next.js App Router · TypeScript strict · PostgreSQL + Prisma · Redis + BullMQ · Vitest (unit + Testcontainers) · Playwright (E2E, visual, axe) · pnpm

```
src/
  app/          routes; (public)/e/[slug] is performance-critical; /check is the independent verification route
  domain/       pure business logic — no I/O
  adapters/     payments, identity, messaging, storage
  db/           Prisma client and repositories
  ui/           primitives, patterns, tokens.css
  copy/         typed copy, keyed by archetype
  lib/
design/         the five reference screens — visual and copy source of truth
```

---

## Design tokens

Base: `--ink #16233D` · `--ink-soft #4A5670` · `--paper #F2F1ED` · `--paper-raised #FFFFFF` · `--rule #D8D6CE` · `--muted-icon #A8A69E`

Archetype accents, from Zulu beadwork colour meanings:

| Group | Accent |
|---|---|
| Union | `#8C2F22` |
| **Bereavement** | **none — omit `--accent`** |
| Remembrance | `#2C4A7C` |
| Arrival | `#4A7C59` |
| Achievement | `#C89211` |
| Gathering | `#A6742B` |

**Fonts:** self-hosted Public Sans variable, `font-weight: 400 800`, **latin + latin-ext only**. Hardcode the two `@font-face` rules — do not request from Google Fonts, it re-adds the Vietnamese subset. No italic face. Tabular figures on all amounts and counts.

Radius: 4px controls, 12px cards. Never pills. Focus: `2px solid var(--accent, #16233D)` at 2px offset. `prefers-reduced-motion` disables all motion globally.

No gradients. No glass. No confetti anywhere in the product.

**Ledger Strand density:**
```
≤30 → 1 cord, 46px pitch, scale 1
≤80 → 2 cords, 40px pitch, scale 0.92
≤200 → 3 cords, 30px pitch, scale 0.78
>200 → 5 cords, 18px pitch, scale 0.58
```
Cash beads solid, in-kind beads ringed with a centre bar — equal visual mass, differing by form not prominence. Size bands unlabelled so amounts cannot be reverse-engineered. No total, no count, no target.

---

## Voice

Plain, warm, direct. Second person. Sentence case.

| Don't | Do |
|---|---|
| Create a campaign | Set up your umcimbi |
| Donate now | Contribute *(Union/Gathering)* / Stand with them *(Bereavement)* |
| Submit | Send my contribution |
| Fundraising goal | What's needed |
| Transaction failed | That payment didn't go through. Nothing was taken from your account. |

An action keeps its name through the flow: "Claim the tent" produces "You've claimed the tent."

Errors say what happened and what to do next. They do not apologise and are never vague. Empty states invite an action.

Never let system vocabulary reach the interface. People manage notifications, not webhook subscriptions.

**Security copy explains what it protects, never just what it blocks.** Not "72-hour hold applies" but "this is the window in which it can still be undone — before it is your problem to fix."

**Verification must never be self-referential.** Never tell someone to call a number shown on the page they are trying to verify. Point to `/check`.

---

## Glossary

| Term | Meaning |
|---|---|
| **isipheko** | Contribution toward the cost of hosting an event. From *ukupheka*, to cook. |
| **umcimbi** | An event or ceremony (pl. *imicimbi*) |
| **umngcwabo** | Funeral |
| **umshado** | Wedding |
| **umembeso** | Gift-giving ceremony after lobola |
| **umbuyiso** | Tombstone unveiling |
| **imbeleko** | Ceremony welcoming a child |
| **itiye** | A tea (a hosted gathering) |
| **umkhaphi / abakhaphi** | One who accompanies — our term for a witness |
| **incwadi** | Book — the record kept at a ceremony |
| **ubuntu** | Mutual humanity; the ethic underlying the custom |

---

## Reference

- Architecture: `docs/architecture.md`
- Decisions log: `docs/decisions.md`
- Design system: `docs/design-system.md`
- Copy library: `docs/copy.md`
- Reference screens: `design/`

**Next.js 16 is newer than your training data.** APIs, conventions and file structure differ from what you are likely to assume. Read the relevant guide in `node_modules/next/dist/docs/` before writing route, config or rendering code, and heed deprecation notices. Do not infer the API from memory.
