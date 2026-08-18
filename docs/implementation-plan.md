# Isipheko — Phase 3 (v2): Implementation Plan

**Supersedes:** Phase 3 v1
**Changed:** updated with decisions settled by the five Claude Design screens; adds the `/check` route; reconciles bank verification; adds a copy layer; restates the performance budget with real measured font numbers.
**Scope:** Milestones 1–4 (no dependency on the outstanding legal opinion)

---

## Part A — How to Work With Claude Code

### A.1 The failure mode to avoid

The common way agentic builds go wrong: you ask for a feature, it generates 900 lines across 14 files, most of it works, and you accept it because reviewing 900 lines is exhausting. Three features later there are four ways of doing the same thing and nobody knows which is canonical.

The defence is **small, verifiable units of work with a written contract for each.** Every task in Part E is sized for a single session and states its own definition of done.

### A.2 Session discipline

**One task per session.** Fresh conversation each time. Context bloat degrades output quality more than people expect.

**Open every session with:**
```
Read CLAUDE.md and docs/architecture.md.
Task: [paste the full task block from Part E]
Do not write code until you have restated the task and listed the files
you intend to create or modify. Wait for my confirmation.
```

That last sentence is the highest-leverage line in this document.

**Close every session with:**
```
Run: pnpm typecheck && pnpm lint && pnpm test
Then update docs/decisions.md with anything you decided that wasn't
specified in the task.
```

### A.3 Rules for the whole project

1. No new dependency without asking.
2. No new architectural pattern without asking.
3. Tests written in the same session as the code.
4. Never mock the ledger — hash-chain logic is tested against a real database.
5. Ask rather than assume. An assumption in code costs ten times what a question costs.
6. Commit per task with the number: `feat(M2-04): needs board claiming with expiry`.

### A.4 VS Code setup

Claude Code extension · ESLint + Prettier (format on save) · Prisma · Error Lens · Playwright Test · REST Client for webhook replay.

```json
{
  "editor.formatOnSave": true,
  "editor.codeActionsOnSave": { "source.fixAll.eslint": "explicit" },
  "typescript.tsdk": "node_modules/typescript/lib",
  "typescript.enablePromptUseWorkspaceTsdk": true
}
```

---

## Part B — Repository Structure

```
isipheko/
├── CLAUDE.md
├── README.md
├── docs/
│   ├── architecture.md
│   ├── decisions.md
│   ├── design-system.md
│   ├── copy.md              ← NEW: the copy library (Part D)
│   └── glossary.md
├── design/                  ← NEW: the reference screens, committed
│   ├── event.html           the public event page — funeral copy, collections,
│   │                        archetype switch. Supersedes the old funeral.html.
│   ├── archetypes.html
│   ├── collection.html
│   ├── contribute.html
│   ├── setup.html
│   ├── dashboard.html
│   └── support.js           shared by every screen above
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   └── seed/
│       ├── archetypes.ts
│       └── need-templates.ts
├── src/
│   ├── app/
│   │   ├── (public)/
│   │   │   ├── e/[slug]/
│   │   │   ├── c/[slug]/        ← contribution flow
│   │   │   └── check/           ← NEW: independent verification route
│   │   ├── (organiser)/
│   │   │   ├── create/
│   │   │   └── manage/[id]/
│   │   ├── (auth)/
│   │   └── api/
│   │       ├── claim/           ← POST, 409 on conflict
│   │       ├── webhooks/
│   │       └── og/[slug]/
│   ├── domain/                  ← PURE. No framework, no I/O.
│   │   ├── event/
│   │   ├── contribution/
│   │   ├── needs/
│   │   ├── ledger/
│   │   ├── archetype/
│   │   └── money/
│   ├── adapters/
│   │   ├── payments/
│   │   ├── identity/
│   │   ├── messaging/
│   │   └── storage/
│   ├── db/
│   ├── ui/
│   │   ├── primitives/
│   │   ├── patterns/
│   │   └── tokens.css
│   ├── copy/                    ← NEW: typed copy, keyed by archetype
│   └── lib/
├── tests/
└── scripts/
    └── verify-ledger.ts
```

**The one structural rule:** `src/domain/` may not import from `app/`, `adapters/`, or `db/`. ESLint enforces it. This is what makes the payment provider swappable.

**`design/` is committed** so Claude Code reads the reference screens directly rather than working from description.

---

## Part C — Design System (as settled)

### C.1 The archetype config pattern — settled

The designs converged on a single config object driving everything. **Bereavement is the fallback, not a special case.**

```typescript
interface ArchetypeConfig {
  key: ArchetypeKey;
  group: ArchetypeGroup;
  accent?: string;              // undefined → renders indigo
  kicker: string;               // "Umngcwabo" | "Umshado"
  verb: string;                 // "Stand with them" | "Contribute"
  amountsPublic: boolean;
  animate: boolean;             // MUST be explicitly false for bereavement
  allowsTarget: boolean;
  allowsProgressBar: boolean;
  allowsCountdown: boolean;
  needsTemplate: NeedTemplateId;
  consequences: Consequence[];  // shown at the archetype choice step
  copy: ArchetypeCopy;          // Part D
}
```

All accent usage in CSS is `var(--accent, #16233D)`. An archetype declaring no accent renders correctly with zero extra code. **This is the enforcement mechanism — do not replace it with conditionals.**

`animate` must be **explicitly `false`** on bereavement, never merely absent. A missing flag is a decision nobody made.

### C.2 Tokens

| Token | Value |
|---|---|
| `--ink` | `#16233D` |
| `--ink-soft` | `#4A5670` |
| `--paper` | `#F2F1ED` |
| `--paper-raised` | `#FFFFFF` |
| `--rule` | `#D8D6CE` |
| `--muted-icon` | `#A8A69E` |

| Group | Accent |
|---|---|
| Union | `#8C2F22` |
| **Bereavement** | **none — omit `--accent`** |
| Remembrance | `#2C4A7C` |
| Arrival | `#4A7C59` |
| Achievement | `#C89211` |
| Gathering | `#A6742B` |

Radius: `4px` controls, `12px` cards. Never pills.
Focus: `2px solid var(--accent, #16233D)` at `2px` offset, globally.
`prefers-reduced-motion` disables all transitions and animations globally.

### C.3 Typography — settled and pinned

**Hardcode the `@font-face` rules. Do not request from Google Fonts** — the pipeline re-added the Vietnamese subset twice during design.

```css
/* Public Sans variable. latin + latin-ext only. No Vietnamese, no italic. */
@font-face {
  font-family: 'Public Sans';
  font-style: normal;
  font-weight: 400 800;
  font-display: swap;
  src: url('/fonts/public-sans-latin.woff2') format('woff2-variations');
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6,
    U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122,
    U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
}
@font-face {
  font-family: 'Public Sans';
  font-style: normal;
  font-weight: 400 800;
  font-display: swap;
  src: url('/fonts/public-sans-latin-ext.woff2') format('woff2-variations');
  unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7,
    U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F,
    U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F,
    U+A720-A7FF;
}
```

Self-hosted, same origin. Measured: latin **26.8KB**, latin-ext **18.5KB**.

Weights used: 400, 500, 700, 800. Body floor 15px, metadata 13px, header 28px. Tabular figures on every rand amount and every needs count.

### C.4 The Ledger Strand — settled

```typescript
const DENSITY = [
  { max: 30,       cords: 1, pitch: 46, scale: 1    },
  { max: 80,       cords: 2, pitch: 40, scale: 0.92 },
  { max: 200,      cords: 3, pitch: 30, scale: 0.78 },
  { max: Infinity, cords: 5, pitch: 18, scale: 0.58 },
];
```

- **Cash bead:** solid `var(--accent)` disc, four coarse diameters (10/14/18/24px) by band. Bands **unlabelled** so nobody reverse-engineers an amount. Bands in cents: `< R100 / < R500 / < R2 000 / ≥ R2 000`.

**Corrected in M2-06 — bands apply only where `amountsPublic` is true.** This line previously said four diameters everywhere, and that is wrong on a bereavement page. Amounts there default to hidden (§7.3, and `defaultAmountVisibility: 'hidden'` in §6), and four monotonic diameters hand back a coarse amount to anybody willing to compare two beads — permanently, in public, on the page the family shared with fifty people. Where `amountsPublic` is false, **every bead takes one diameter (14px)** and the forms differ by shape alone. The rule reads the same config flag that sets the visibility default, so the two cannot drift. `design/event.html` bands its funeral variant; that is a prototype bug of the same class as the accent literal M1-04 found, not a decision.

- **In-kind bead:** same diameters, white fill, 2px accent ring, 2px horizontal bar across the middle. Equal visual mass — the forms differ by shape, never by prominence. A pure in-kind contribution has no amount to band and takes the 14px middle diameter, never the smallest.
- **Group bead (collections):** a third form — a bead with a visible ring of smaller beads around it, or equivalent — opening to reveal the members inside. One bead per collection, never one per member.
- No total, no count, no target displayed.
- Each bead is a real `<button>` with a 44px hit area via padding while the visible bead stays small. **M2-06:** they are submit buttons in one `<form method="get">`, so opening a bead is a server round-trip that works with JavaScript disabled — the same posture as claiming.
- Beads are CSS-drawn `<div>`s in declared markup, not JS-generated. **M2-06:** geometry travels as two custom properties per bead (`--x`, `--y`) and everything else is in the stylesheet, which is what keeps 200 beads inside 15KB.
- Screen readers get the strand as a list. **M2-06:** an `aria-label` on the strand as an image would have to say how many people are in it, which is the count this element refuses to display. So it is `<ul>`/`<li>` at every density.
- **M2-06:** an in-kind bead needs an in-kind ledger entry, and nothing wrote one until now. Confirming a delivery creates the `in_kind` contribution and appends its entry in one transaction — see docs/decisions.md M2-06.

### C.5 Behaviours settled by the designs

**Claim interaction:** `idle → pending → claimed | conflict`. Server round-trip, never optimistic. `POST /api/claim` with a conditional update; 409 drives the conflict branch. 15-second `Undo`, also a server action. Must work with JavaScript disabled via `<form method="post" action="/api/claim">` with hidden `event` and `item` fields.

**Reference code:** stored split — `ref: ["MTH", "4K7B2X"]` — so prefix and code style separately. Crockford base32, case-insensitive, ambiguous characters normalised (0/O, 1/I/L).

**PayShap display:** number shown with the verified organiser name beside it (`"N. Dlamini · verified organiser"`) so the contributor can check the name matches before paying.

**Money display:** `raised / settling / available` on the dashboard. The hold fences off only the recent portion — the rest is withdrawable now.

---

## Part D — Copy Layer

The designs produced copy substantially better than placeholder text, and it is archetype-specific. It must live in the codebase as typed data, not scattered through components.

`src/copy/` exports one `ArchetypeCopy` per archetype:

```typescript
interface ArchetypeCopy {
  chooseIntro: string;
  amountTitle: string;
  amountIntro: string;
  itemTitle: string;
  itemIntro: string;
  whoIntro: string;
  messagePlaceholder: string;
  visibilityIntro: string;
  visibilityFoot: string;
  needsIntro: string;
  needsFoot: string;
  witnessLead: string;
  witnessBody: string;
  doneTitleMoney: string;
  doneTitleItem: string;
  doneBodyMoney: string;
  doneFoot: string;
  verifiedLine: string;
}
```

**Extract the strings from `design/*.html` verbatim.** They were written carefully and reviewed. Do not paraphrase.

Anchor examples that must survive:

- Witness framing: *"Being asked to witness a family's umcimbi is not a small thing — it says you trust them with the family's business. Most people are honoured to be asked. Pick the ones the family would nod at."*
- Second witness hint: *"Someone in another household, so it is not all one roof."*
- Needs: *"People can bring the thing itself or put money toward it. You do not choose that for them."*
- Visibility: *"The couple always sees the full record, whatever you choose here."*
- Empty queue: *"Nothing is waiting for you. Everything people have told us about has been checked off. You can put the phone down."*
- Trust panel: *"Do not use a number on this page. If the page were fake, the number would be too."*
- Verification honesty: *"It confirms who the organiser is. It does not, on its own, confirm the ceremony."*

**Voice rules:** plain, warm, second person, sentence case. Never "campaign," "donate," "fundraiser," or "goal." An action keeps its name through the flow — "Claim the tent" produces "You've claimed the tent." Errors say what happened and what to do next; they never apologise and are never vague.

**i18n:** this structure is the translation unit. Build it keyed from commit one — retrofitting is expensive, and the emotional moments in this product do not happen in a second language.

**Open, and blocking nothing yet:** every string in `src/copy/` is English, and there is no locale on an organiser or an event. M2-07 needed "the organiser's language" for the WhatsApp message and could not have it. Translation needs a first-language isiZulu speaker (open item 9); the shape is ready, the words are not. Add the locale **with** the translations, not before them.

---

## Part D2 — Collections (Two Organiser Roles)

### D2.1 Why this exists

The original definition of isipheko is a contribution *"organised by family/friends attending the event and given to the organiser."* The system as first specified collapsed two distinct roles into one. They must be separated.

| Role | Who | Receives money? | Verification leverage |
|---|---|---|---|
| **Host** | Running the umcimbi | Yes, via payout | Payout can be withheld |
| **Collection organiser** | A guest rallying a group | **Yes — into her own account** | **None. We never hold it.** |

A collection is a group of contributors pooling into the collection organiser's own account, handed over to the host as one act. **The host does nothing in the system.**

### D2.2 The regulatory position — better, not worse

This is the safest configuration in the product. Contributors pay the collection organiser directly; she hands over however she likes. We never touch the money, and neither does the host. She is a private person collecting from friends, which is not regulated activity for her, and we are a ledger.

**But it removes our verification chokepoint.** With a host, we can withhold payout until verified. With a collection, she already has the money before we could object.

**Three compensating controls, all required:**

1. **Verification gates sharing, not payout.** No verified identity, no shareable link. This is the only moment of leverage that exists.
2. **The social graph does real work.** Collections are shared into groups of people who know each other — cousins, colleagues, a congregation. The organiser is a known person with a reputation at stake. This is a materially different anonymity profile from a public link, and the product should lean on it rather than pretend otherwise.
3. **Witness confirmation of handover** (see D2.4).

### D2.3 Occasion is required; a host event page is not

A collection always names an occasion, which drives archetype, tone and copy. But the occasion need not be a full event page in the system.

- **Attached collection** — a host event page exists. The collection appears there as **one bead**: *"The Ngcobo cousins — R5 000"*, tapping to reveal members.
- **Standalone collection** — no host page. The collection knows its occasion and renders in the matching archetype, but stands alone.

**Rationale:** requiring a full event page first is friction at the moment enthusiasm is highest — someone says "should we do something for Thabo?" and there may never be a formal ceremony. But a collection with no occasion at all is just a pot, which is the undifferentiated space where BackaBuddy competes at zero fees.

### D2.4 Handover

The host does nothing in the system, so the handover cannot depend on them. Confirmation, in order of preference:

1. **Witness confirmation (default).** One contributor, present at the handover, confirms. Needs nothing from the host and the witness is already in the group.
2. **Organiser marks handed over with evidence** — a photo of the group, the envelope, the moment.
3. **Optional host acknowledgement** — a single SMS link, one tap, no account. Available but never required.

**The handover is the emotional peak of the product.** A group hands over money *and* the printed record of who gave — which is precisely the custom as originally described. Design it as a moment, not a status change.

### D2.5 Group in-kind claiming

A collection can claim a need item **as a unit**. Eight cousins jointly claiming the tent is how families actually operate — unaffordable alone, trivial together.

This produces a better ledger entry than cash: *"The Ngcobo cousins — the tent"* is specific, memorable and reciprocable in a way that *"R5 000"* is not. It is also more useful to the host: cash means a grieving family still has to go and hire a tent.

The needs board already tracks partial quantities, so this is a small extension of existing machinery.

### D2.6 Honesty requirement

The collection organiser holds the money, not us. The trust panel on a collection page **must say so plainly** — the contributors are trusting her, not Isipheko. Copy that implies otherwise would be the one dishonest thing in an otherwise honest product.

### D2.7 Positioning guard

Collections will be more frequent, lower-stakes and easier to start than ceremonies, so they will generate learning faster. Build them early. **But do not lead with them in positioning** — a group-pot app that also does ceremonies is undifferentiated. Collections are how people arrive; the ceremony product is why they stay.

### D2.8 Schema changes — do these in M1-02

```
organisers                    → split conceptually; add `role` is NOT sufficient.
                                A person may be a host on one event and a
                                collection organiser on another.

collections                   NEW
  id, occasion_archetype, title, purpose,
  event_id (nullable — attached vs standalone),
  organiser_id, organiser_bank_hint (display only, never stored as an account
    we can pay), handover_status, handover_confirmed_by, handover_evidence_key,
  need_item_id (nullable — group in-kind claim),
  status, created_at

collection_members            NEW
  id, collection_id, name, phone_e164 (nullable),
  amount_cents (nullable for in-kind participation),
  visibility, status, joined_at

contributions                 ADD collection_id (nullable)
                                A contribution belongs to a collection or
                                stands alone. Never both.

ledger_entries                ADD entry_type 'collection'
                                One entry per collection, not per member.
```

**Critical:** `collections` has no payout, no float, no disbursement. There is no money path through us. Any task that adds one is wrong.

**Done in M1-02, with the rules built in M2-09.** The tables, the enums, the archetype/group CHECK and the grants shipped with the schema; `ledger_entries` already allows a collection chain. M2-09 added one column beyond this list — `need_claims.collection_id`, nullable — because a group claim has to reserve through the **same** conditional UPDATE every other claim uses, and a claim row had no way to say the claimant was a group. Without it there is also no way to release an item when a collection is abandoned. See docs/decisions.md M2-09.

---

## Part E — Task Breakdown

### Milestone 1 — Foundation

**M1-01 · Project scaffold**
*Deps:* none
Next.js App Router + TypeScript strict, ESLint with the `domain/` boundary rule, Prettier, Vitest, Playwright, pnpm. Zod env validation at boot — the app refuses to start on a missing var.
*Done:* `pnpm dev`, `typecheck`, `lint`, `test` pass on a clean clone.

**M1-02 · Database and schema**
*Deps:* M1-01
Postgres via Docker Compose, Prisma, full schema from architecture §4.2. Includes the bereavement CHECK constraint, `REVOKE UPDATE, DELETE ON ledger_entries`, and the column-encryption helper for bank account numbers.
*Done:* migration runs clean; a test proves the CHECK rejects a target on a bereavement event; a test proves the app role cannot UPDATE a ledger entry.

**M1-03 · Money primitive**
*Deps:* M1-01
Integer cents, ZAR only. Arithmetic, parsing, formatting as `R1 234,56` — space thousands separator, comma decimal.
*Done:* property tests confirm no precision loss over 10k random operations.

**M1-04 · Archetype system**
*Deps:* M1-02
`ArchetypeConfig` per Part C.1, all six groups seeded. `animate: false` explicit on bereavement. `consequences` populated. Type-level enforcement so a component requiring a target cannot compile against a bereavement config; runtime render guard as backstop.
*Done:* a `@ts-expect-error` assertion proves a progress bar cannot typecheck against bereavement; a test asserts `animate === false` (not `undefined`) for every bereavement archetype.

**M1-05 · Design tokens, fonts, UI primitives**
*Deps:* M1-01
`tokens.css` per Part C.2. **Self-hosted Public Sans with the two hardcoded `@font-face` rules from Part C.3 — no Google Fonts URL.** Primitives: Button, Field, Select, Sheet, Card, Toast. Accent applied via `var(--accent, #16233D)` — no conditionals.
*Done:* a tokens page renders every primitive in all six themes including the no-accent fallback; only two woff2 files ship; no italic face; axe zero violations; focus visible everywhere.

**M1-06 · Auth (organiser)**
*Deps:* M1-02
Phone-first OTP via SMS. No passwords. Sessions, rate limiting (3 OTP per number per hour), audit entries on every auth event.
*Done:* full login works end-to-end; rate limit verified; no OTP in any log.

**M1-07 · Event creation flow**
*Deps:* M1-04, M1-05, M1-06
Six steps: `kind → details → needs → witnesses → verify → share`, per `design/setup.html`. Consequence preview at the kind step. Needs pre-filled from template. Unguessable slug (≥16 base62). Draft state before publish.
*Done:* an event can be created and retrieved; slug entropy verified; drafts not publicly reachable; consequence copy renders per archetype.

**M1-08 · Public event page + performance gate**
*Deps:* M1-07
Server-rendered per `design/event.html`. Zero client JS above the fold. `noindex` headers. CI gate failing the build on budget breach (Part G).
*Done:* Lighthouse on throttled 3G shows LCP ≤ 2.5s; the gate is proven to fail on a deliberate regression.

### Milestone 2 — Contribution

**M2-01 · Ledger core**
*Deps:* M1-02, M1-03
Hash chain per architecture §4.3. Append-only, genesis entry, per-event sequence, reversal entries, `scripts/verify-ledger.ts`.
*Done:* a test tampers with a historic row via raw SQL and the verifier detects it; concurrent appends produce no gaps or duplicates.

**M2-02 · Reference codes**
*Deps:* M1-07
Crockford base32, 6 chars, stored split as `["MTH","4K7B2X"]`. Case-insensitive with ambiguous-character normalisation.
*Done:* 100k codes, no collisions within an event; `mth-40g1bx`, `MTH-40G1BX` and `MTH-4OGLBX` all resolve.

**Corrected in M2-02.** This line previously read `MTH-4KZBZX` against a stored `MTH-4K7B2X`, which no normalisation can satisfy: it needs `Z→7` in one position and `Z→2` in another, and if `7` and `2` both aliased to `Z` the alphabet would halve in the worst possible way. The replacement exercises Crockford's actual aliases — `O→0`, `I→1`, `L→1` — which is what Part C.5 specifies.

**Also corrected:** "no collisions" is a property of the unique index on `(ref_prefix, ref_code)` plus generate-and-retry, not of the generator. 32^6 ≈ 1.07 × 10^9, and the birthday bound over 100 000 draws predicts about 4.7 collisions — a test asserting zero from randomness alone would be flaky rather than passing.

**M2-03 · Needs board — data and rules**
*Deps:* M1-07
Quantity, partial claiming, claim expiry, organiser delivery confirmation, suggested items awaiting approval.
*Done:* claiming reserves atomically under concurrent load — two people cannot claim the last chair; expiry returns quantity correctly.

**M2-04 · Needs board — interface and claim API**
*Deps:* M2-03, M1-05
Per Part C.5. `POST /api/claim` with conditional update and 409. `idle → pending → claimed | conflict`. 15-second server-side Undo. **`<form method="post">` fallback that works with JavaScript disabled.**
*Done:* claim works with JS off; concurrent claim shows the conflict branch, not a false success; keyboard navigable; adds ≤ 20KB to the page.

**M2-05 · Contribution flow — Mode A**
*Deps:* M2-01, M2-02, M2-04
Five steps: `choose → amount|item → who → pay → done`, per `design/contribute.html`. **No account, no login, no email field anywhere.** Visibility control with archetype-driven default — public for Union/Gathering, hidden amounts for Bereavement. PayShap number shown with verified organiser name. One-tap reference copy. Rate limiting per IP and per phone. 14-day expiry on unconfirmed reports.
*Done:* full path to confirmed ledger entry passes E2E; a test asserts zero password/email/signup inputs exist in the flow; abuse limits verified.

**M2-06 · The Ledger Strand**
*Deps:* M2-01, M1-05
Per Part C.4, `DENSITY` table exactly as specified. Server-rendered. Motion suppressed where `animate === false`.
*Done:* renders correctly at 1, 12, 40, 200 and 400 contributions; ≤ 15KB at 200; no total or count displayed; screen-reader accessible as a list.

**M2-07 · WhatsApp share + OG images**
*Deps:* M1-07
Per-event OG image generated server-side, cached in object storage. Share sheet with a pre-written message keyed by archetype, **in English at launch**. **Verified badge legible at thumbnail size** — bead colour, name and tick carry the card.
*Done:* preview renders correctly in WhatsApp on iOS and Android; generation cached, not per-request.

**Corrected in M2-07 — "in the organiser's language" was unbuildable.** There is no locale on an organiser or an event and no isiZulu copy anywhere: `src/copy/` is the translation unit Part D describes, with one language in it. Translating it needs a first-language speaker, which is open item 9 and a piece of work in its own right rather than a line in this task. The message is therefore keyed by archetype and written in English, in `src/copy/share.ts`, which is the file a translation pass replaces. **Part D's i18n note now carries this as a dependency** — no language column was stubbed, deliberately: an unused column is an invitation to populate it badly.

**The badge is a slot and draws nothing.** Verification is M3-01 and the gate is M3-02, so the card carries the name and no tick, and `setupCopy.share.intro` — *"Every person who opens it sees your verified name"* — is not shipped. Same call as M1-08 §5.

**"Renders correctly in WhatsApp on iOS and Android" is still open.** WhatsApp's crawler fetches from the internet and cannot reach a development server; it needs a public URL and two real phones. The automated half is `tests/e2e/og-image.spec.ts`; the device checklist is in docs/decisions.md M2-07.

**M2-09 · Collections — data and rules** *(NEW)*
*Deps:* M2-01, M2-03
Schema per Part D2.8. Attached and standalone collections. Members, joining, visibility. Group in-kind claim of a need item as a unit. One ledger entry per collection, never per member.
*Done:* an attached collection renders on the host event page as a single entry; a standalone collection resolves with its archetype; a collection claiming a need item reserves the whole item atomically; **a test asserts no payout, float or disbursement path exists on a collection.**

**M2-10 · Collection page and joining** *(NEW)*
*Deps:* M2-09, M2-05
The collection page: members, running total, what they're collecting toward. Joining reuses the contribution flow — **still no account for members.** Verification gates *sharing*, not payout: no verified identity, no shareable link.
*Done:* an unverified organiser cannot generate a share link; members join without accounts; the trust panel states plainly that the organiser holds the money, not Isipheko.

**Expect no demoable share path until M3-02.** M2-09 built the gate and it refuses everybody: `canShare` requires `idVerificationStatus === 'verified'`, M3-01 is what sets that, and nothing sets it today. So a collection can be created, joined, claim an item and be handed over — and cannot be given a link. That is rule 13 working rather than a gap to route around, and it is the same shape as M1-07 §5's missing verification clause. Tests set the status directly to exercise the shared path; **do not add a flag that bypasses it.**

**Built in M2-10, and none of it bypasses the gate.** `/c/[slug]` is a route handler with the same posture and the same 150KB ceiling as the event page, and `pnpm gate:size` measures it (31.6KB first load). Joining is the contribution flow's shape with no payment step, because there is no payment rail: the last screen shows the organiser's own words about where to send it and takes the person's word that they did. The organiser's screen asks for the link and is told no, in the words `collectionCopy.shareBlocked` uses.

**One design element could not be built: the shortfall line.** `design/collection.html` computes *"The tent costs R1 200 and we have R900. Still R300 short"* from an item's cost, and a need item carries the organiser's free text — *"Around R1 200 to hire"*, *"Mealie meal, rice, sugar, oil"* — rather than a number (M1-07 §3). Parsing that into arithmetic on a page whose subject is money, where being wrong tells a group they are short when they are not, is not a trade worth making. **It needs need items to carry a real cost, which is a separate decision with its own cost.** See docs/decisions.md M2-10.

**M2-11 · Handover** *(NEW)*
*Deps:* M2-10, M4-02 *(soft — album can follow)*
Witness confirmation as default. Organiser-marks-with-evidence as fallback. Optional one-tap host acknowledgement by SMS link, never required. Generates the group's album.
*Done:* handover completes with the host taking no action in the system; witness confirmation works from a contributor's phone; ~~evidence photo EXIF-stripped per M4-01 rules~~ — **deferred, see below**.

**Built:** a witness link that reaches one of the group and is spent by one tap; the organiser closing it on her own word when nobody can; the family's optional acknowledgement, which writes no ledger entry and never displaces the account of who actually closed the record; and the **incwadi**, the one page the group prints and hands over — every name, every amount, the total, who collected it, and how it was confirmed.

**The third criterion is deferred, not met.** "Evidence photo EXIF-stripped per M4-01 rules" needs M4-01, which does not exist. A JPEG straight off a phone carries GPS coordinates, and on a funeral handover those are the family's home — published to anyone with the link. Improvising a stripper in a task about something else, or building a second one that duplicates M4-01, are both worse than waiting. So the fallback is *"marked by her, on her word"*, and the record says exactly that. **The photo attaches in M4-01 to a record that already exists.**

**Nothing sends the links.** No BSP is configured (M2-08), so the organiser's screen shows each link and she passes it on the way she already talks to these people. No new WhatsApp template was added, for the reason M2-08 §6 gives about the payout templates.

**The album boundary held.** The incwadi is the sheet handed over on the day; M4-02's album (messages and photos across an umcimbi, strand as cover) and M4-03's PDF are different artefacts and stay theirs.

**M2-08 · Notifications**
*Deps:* M2-05
WhatsApp utility templates via BSP adapter. **Batched digests, max one per hour to the organiser, per umcimbi.** SMS for OTP only. Email fallback for organisers and witnesses.
*Done:* 50 contributions in 10 minutes produce exactly one organiser message; template categories verified as utility, not marketing.

**Settled in M2-08, and none of it should read later as an unexplained constraint:**

**Digests are held to 07:00–21:00 SAST.** A digest is non-urgent by construction — that is what makes it digestible — so holding it costs nothing, and a phone buzzing at three in the morning about contributions to your mother's funeral is a harm this product would otherwise have shipped without noticing. The *build* is held rather than the send, so a night's updates arrive as one message in the morning rather than as a 03:00 snapshot that misses whatever happened at dawn. Immediate messages — a contributor's confirmation, a claim, a two-day warning — are unaffected.

**The cap is per organiser per umcimbi**, not per organiser. A digest mixing a wedding and a funeral into one message is the worst possible output of a batching rule; a third message an hour to somebody running three imicimbi is trivial against that.

**Email is not a fallback for contributors.** §8.2 says email backs every row, and it was written before rule 4 was as firm as it is: a contributor has no account and is never asked for an address, so where there is no phone number there is nothing to fall back to. Some contributors are not notified. The alternative is collecting addresses, which costs the property M2-05 has a test guarding.

**No queue.** Architecture §3 lists Redis + BullMQ; neither is installed, and M1-06 §4 already declined to add Redis for rate limiting. An outbox table, a digest-entry table and `pnpm notify` (hourly) do the job transactionally; BullMQ can replace the runner later without touching either table. See docs/decisions.md M2-08 §1.

**The three payout rows of §8.2 have no templates.** Mode B is gated on the legal opinion, so they cannot be sent or tested, and a template that looks reviewed but has never been exercised is worse than an obvious gap. The registry is shaped so they slot in.

### Milestone 3 — Trust

**M3-01 · Identity verification adapter**
*Deps:* M1-06
Provider interface + one implementation. Async job with polling UI — never blocking, must survive a 120-second pending response. Peppered ID hashing via KMS. Selfie and DHA photo never persisted. Timestamped consent capture.
*Done:* a test proves no plaintext ID number and no image reaches storage or logs.

**Built, with two qualifications recorded against Part J rather than quietly met.** "Via KMS" is not met — the pepper is an environment variable and the seam for moving it is `hashIdNumber`'s argument (item 2a). "No image is persisted" is met because **no image is captured**, and whether one ever is depends on the vendor (item 2).

M3-01 also added `/verify`, which is **organiser-level rather than event-level**: verification is a property of the person, so one check serves every event they set up and every collection they run. The collection organiser's screen links to it, which closes the refusal-with-no-way-out that M2-10 §10 left open. **The publish gate is still M3-02** — `canPublish` carries no verification clause today, deliberately.

**M3-02 · Verified badge and publish gating**
*Deps:* M3-01, M1-07
Verification required before publish. **Built.** `canPublish` carries the clause M1-07 §5 left out and `publishDraft` carries it again as a condition on the UPDATE, so a caller that never asks the domain publishes nothing. The badge is above the fold with its date, in the trust panel, and on the OG card — where a second hard-coded `verified={false}` in the image route turned out to be drawing an unbadged picture at a URL whose hash already claimed the badge. The tick on the card is an inline SVG, because Satori has no font for U+2713 and answers a missing glyph by fetching one over the network. Badge above the fold with date. `"Why can't I skip this?"` secondary action explaining the reason rather than demanding compliance.
*Done:* an unverified event cannot be published; badge appears in the OG image.

**M3-03 · Witnesses (abakhaphi)**
*Deps:* M1-07
Invite by phone, accept/decline, public display. Copy per Part D — honour, not audit. Relation hints on each slot.
*Done:* invite and acceptance work end-to-end; witnesses render publicly; nothing is sent before they agree.

**Built.** The invite is a capability at `/k/<token>` — the third of three, beside `/w/` and `/h/`, tabulated in docs/decisions.md M3-03 — and **nothing is sent**: the organiser is given the link and passes it on herself, as she does the handover link (M2-11 §7). The public page names only those who agreed; a decline is recorded and never published. Publishing still needs a *named* umkhaphi rather than an accepted one, deliberately.

Two things beyond the task, both recorded: `replaceWitnesses` deleted and rewrote every row on each save, which would have wiped acceptances and live links the first time an organiser added a third person — it reconciles on the phone number now. And `setupCopy.witnesses.askBody` said *"We send them one message"*, which this task made false.

**M3-03 note:** the trust panel's "what Isipheko has checked" block is true as of M3-02 and states the limit of what a badge means. M3-04 owns the panel itself.

**M3-04 · "Is this real?" panel**
*Deps:* M3-02
Permanent panel on every event page. Not styled as a warning. Must state that a number on the page cannot verify the page, and link to `/check`.
*Done:* present on every event page; no self-referential verification route anywhere in the copy.

**Built, together with M3-05 — see below.** "Every event page" turned out to mean the contribution flow as well, which had no panel, no safety line and no badge: that is the screen where somebody is looking at a number they are about to pay, having navigated away from the page that reassured them. The link to `/check` sits **under** the typed instruction and is labelled with the literal address; docs/decisions.md M3-04 §2 records why both conditions matter.

**M3-05 · `/check` — independent verification route** *(NEW)* — **built inside M3-04, not outstanding**
*Deps:* M3-02
The canonical route the trust panel and verify screen both point to. Someone holding a link, a reference code, or an organiser name can confirm independently whether an event is real and verified. **Must be reachable without following a link from the event page** — that is the entire point.
*Done:* resolvable by slug and by reference code; returns verification status and organiser name; rate-limited against enumeration; exposes no personal data beyond what the event page already shows publicly.

**Merged into M3-04 and shipped with it.** A panel whose whole content is an instruction to come here could not ship pointing at a 404, and this route's only dependency was M3-02. It resolves a code, a slug or a whole pasted link; a contribution's code resolves to its event; a draft answers exactly like a code nobody was issued. The rate limit is in memory and says so — architecture §10's edge half is the one that works for a public read.

**Not built, and it is a real gap:** resolution by **organiser name**. The spec offers it and it is not implemented — a name is not unique, so it is a search rather than a lookup, and a search over organiser names on an unauthenticated endpoint is a way to ask which people have set up an umcimbi. It needs a deliberate design (exact-match only? paired with something else?) rather than a `contains` query. Whoever picks it up should read docs/decisions.md M3-04 §7 first.

**M2-08b · Threading `now` through the notification path** *(NEW — done)*
*Deps:* M2-08
Three integration tests passed only before 03:00 SAST: the scenario ran on the wall clock while the flush was asked about a fixed timestamp. Fixed by threading the clock through the tests, and by supplying `created_at` on `notifications` and `digest_entries` rather than letting the column default — retention reads both. **The integration suite is clock-independent as of this task**, and CLAUDE.md carries the rule. `contributions.created_at` has the same shape and is deliberately untouched; see docs/decisions.md M2-08b §5 before touching M2-05's sweep.

**M3-06 · Report channel**
*Deps:* M3-04
Report form, monitored queue, acknowledgement path with an SLA.
*Done:* a report creates a reviewable record and sends an acknowledgement.

**Built.** `/report` takes a report about an event, a collection, or **nothing we hold** — a link that resolves to nothing is the scam case, and `/check` offers the path at exactly the moment somebody discovers one. No account, no email, no script.

The acknowledgement is a **reference on screen**, immediately, because no BSP exists to send a message and 57% of people who report a scam hear nothing back: an acknowledgement that queues is not one that arrives. The message goes to the outbox as well, for the day there is a provider. Somebody who leaves no number is told plainly that the screen is the whole of it.

The SLA is **one working day**, stored on the record and stated in the copy so the two cannot drift, and `pnpm notify` prints the queue every run **including when it is empty**.

**Read docs/decisions.md M3-06 §1 before changing anything here.** It records a standing rule: a report does nothing by itself. The review screen a person works from is M3-07's, deliberately.

**M3-07 · Audit log and admin review**
*Deps:* M1-02
Append-only audit of every security-relevant action. Minimal internal review queue for flagged events.
*Done:* auth, publish, confirm, payout-request and report events all logged; log not mutable by the app role.

**Built, with one criterion answered by saying no.** Auth and identity were already logged (M1-06, M3-01); this added publish, both confirmations, both handover paths and both report events, and moved the taxonomy into `src/domain/audit/` so the closed set of action strings is a contract rather than a convention. **`payout-request` is not logged and must not be**: Mode B is Milestone 5 and no payout can be requested today, so the three action strings are reserved and documented in the taxonomy and deliberately absent from the union — a logger for an action nobody can take is dead code wearing the appearance of a reviewed control.

*"Not mutable by the app role"* needed no migration — the grants have been right since M1-02 — but the existing test only proved an ORM update is refused, which says nothing about a psql session running as the app. Raw SQL UPDATE, DELETE and TRUNCATE are now all proved refused.

**"Flagged events" has no referent, and that is the design.** Nothing flags an event, because nothing may (M3-06 §1). Reported is the only thing an event can be, so the queue is the report queue — ordered by the deadline somebody was promised rather than by arrival, with the reported umcimbi's audit trail beside each one, which is why M3-06 §9 left this screen to ship with the log.

**The standing rule moved one layer along and is tested there.** M3-06 proved a report changes nothing about an event. M3-07 proves *triage* changes nothing either — the obvious next hole, since triage is the human decision the rule reserves for a person. The event row is compared whole across a full received → reviewing → closed pass, again with five reports all closed, and the rendered public page is compared before and after.

Access is an `ADMIN_PHONE_NUMBERS` environment allowlist checked against an ordinary session — **not a column**, because the app role holds UPDATE on `organisers` and a flag the application can set on itself is not a privilege boundary. It is a stopgap shape and belongs on Part J beside the KMS item; read docs/decisions.md M3-07 §2 before treating it as the intended design. Reading the queue is logged, not only acting on it.

**M3-07b · Review queue pagination** *(NEW — outstanding)*
*Deps:* M3-07
`reviewQueue` takes 100 (`src/db/repositories/report.ts`), ordered by the deadline somebody was promised, and the screen says nothing about it. A reviewer who scrolls to the bottom of a silently-capped list believes they have seen everything — so **the SLA fails invisibly, on the one screen built to guarantee it**, and the reports that fall off are the newest ones, whose deadlines have not yet arrived.

Found by two E2E tests failing against a local database that had accumulated 108 open reports; the cap is real in production and the failure mode there is a person, not a test.

Either paginate, or show how many there are and state plainly that more exist below the cut. **What must not remain is a bottom that looks like the end and is not.** Note that a count on this screen is a count of reports, not of contributions — rule-free, unlike the album and the strand.
*Done:* a reviewer can reach every open report; no list terminates without saying whether it is complete.

**M3-08 · Organiser dashboard**
*Deps:* M2-05, M3-03
Per `design/dashboard.html`. Confirmation queue leading the page with its empty state. Needs board from the organiser's side — claimed-not-delivered vs unclaimed. `raised / settling / available` money split. Payout conditions with `protects` and `remedy` on every condition. **Use Stitch BAV for bank verification, not the R1 deposit flow in the design file — see Part F.**
*Done:* confirm and mark-delivered are the two easiest actions on the page; every unmet condition shows a concrete next step; the 72h hold fences only the recent portion, never the whole balance.

**Built, and the money section is where the design had to be overruled.** `design/dashboard.html` renders *"Ready to pay out now — R44 600"* above a **Request** button, under *"Money sits in a held Isipheko account"*. None of it is true: Mode B is Milestone 5, and under Mode A the contributor pays the organiser directly, so the money is already in her own account. The split is computed for real from the ledger and labelled for what it is — **Confirmed on the record**, **Still inside the 72 hours**, **Settled** — with no request button anywhere. Gating the section behind `mode: 'hosted'` was considered and rejected: no event is hosted, so it would render nowhere.

**`design/dashboard.html` now has three known-untrue elements** and should be checked rather than copied: the R1 test deposit (Part F), the **countdown on the bereavement variant** — *"in 4 days"*, which rule 1 forbids and `allowsCountdown` exists to prevent — and the held-balance payout section. Read docs/decisions.md M3-08 §2 before working from that file.

The four conditions render with `protects` and `remedy`, and **only identity has a button**, because `/verify` is the only screen that exists: bank verification needs a Stitch BAV adapter and approval needs a payout, both Milestone 5. Where a remedy cannot be acted on the copy says so rather than leaving a dead end. None of the four always passes — identity is unmet on a draft, which is why the dashboard stays reachable before publishing.

Two things beyond the task, both recorded. The confirmation queue is **one list** rather than the stub's two cards, because two lists put the deliveries below the payments. And **suggestions from M2-04 had been built, tested and unreachable** — a contributor could tell a family they had forgotten something and no organiser could ever see it; they are the fourth group on the board now.

### Milestone 4 — Album

**M4-01 · Messages and photos**
*Deps:* M2-05
Attach to a contribution. Upload limits, dimension caps, EXIF stripped, content-type validated by magic bytes not extension.
*Done:* oversized and mistyped uploads rejected; EXIF confirmed stripped; served as AVIF with WebP fallback.

**M2-11's handover evidence is waiting on this.** The handover's fallback path — the organiser marking it herself — was built without the photo the design offers, because a JPEG off a phone carries the GPS of the house it was taken at and there is no stripper yet. `collections.handover_evidence_key` exists and is unused. When this task lands, the photo attaches to a record that already exists; do not add a second stripping path for it.

**Built, and it needed the first new runtime dependency since the scaffold.** AVIF needs an AV1 encoder and there is no way to have one without a package; `sharp` was the one to take because it is already an optional dependency of Next itself, for the image optimiser. It is server-side, so the 150KB budget is untouched — `/e/[slug]` still measures 35.9KB. Everything that *can* be written without a codec is: the magic-byte sniff and the metadata reader are in `src/domain/media/`, and `src/adapters/media/sharp-image-processor.ts` is the only file in the codebase that imports sharp.

**The reader is independent of the encoder, deliberately.** A test in which sharp is asked whether sharp stripped the metadata proves that it agrees with itself. `scanImageMetadata` walks JPEG segments, PNG chunks, RIFF chunks and ISO-BMFF boxes by hand, and `findGpsFix` parses the EXIF GPS IFD, so the fixture can be proved to carry a real fix in KwaZulu-Natal before the output is proved not to. **All four derivatives are asserted clean** — full and thumb, AVIF and WebP — because a stripped AVIF beside an unstripped fallback is the whole protection lost to whichever format the browser picks.

**The original is never stored.** Only the four re-encodes are, content-addressed, under `photo/<event>/`. Keeping the source "just in case" would keep the GPS with it for as long as the bucket exists.

Three things beyond the spec, all in docs/decisions.md M4-01: the photo is processed at the *who* step and carried forward as an **HMAC-signed ticket** bound to the event, because the row does not exist yet and a hidden field is a field anybody can edit; there are **two size limits**, 8MB for a photo and 24MB for a body, so a real oversized photo is refused with the flow's state intact and only an abusive one is refused unread; and a photo attached to an **anonymous** contribution is allowed with the conflict stated plainly rather than silently overridden.

**M4-01b · Handover evidence photo** *(NEW — outstanding)*
*Deps:* M4-01
Where M2-11's deferral lands. `collections.handover_evidence_key` still exists and is still unused. The pipeline it was waiting for is built and reusable — `acceptPhoto` in `src/lib/contribution-photo.ts` — so this is the organiser-authenticated surface, not a second stripper: the upload control on the collection handover screen, `src/copy/collection.ts` rewritten from *"a photo will be part of this later"*, and `tests/unit/handover.test.ts:140` inverted from asserting the copy claims no photo to asserting it claims one and can take it.
*Done:* an organiser can mark a handover with a photo; the record says it was her word with evidence rather than a witness's tap; the copy no longer promises a later.

Kept separate from M4-01 on purpose. It is a different surface with its own authorisation, and it changes what a collection record *claims about its own provenance* — which deserves its own mutation checks rather than riding along with a contributor-side upload.

**M4-02 · Album view**
*Deps:* M4-01, M2-06
Every message, photo and contribution as one readable artefact. Strand as the cover.
*Done:* renders at 1 and 400 entries; lazy-loads below the fold.

**Built.** `/e/[slug]/album` — a route handler shipping zero JavaScript, like the event page and for the same measured reason. **44.6KB at four hundred entries** (18.4KB of brotli'd document plus the font), against a budget now set at 50KB rather than the 60KB it was provisionally given. Photos are excluded from that number deliberately: they lazy-load, one request each, and the document is what a reader pays for before any of them arrive.

**Read from the ledger, like the strand, and one read produces both.** The cover and the entries come out of the same query — two queries could disagree by a row written between them, and the disagreement would be invisible: a bead pointing at an anchor that is not on the page. Two consequences, both intended: a reversed entry is not in the album, and **an unconfirmed contribution is not either**. The album is the record, not the inbox.

**That made the contribute flow's done screen untrue, and it has been fixed.** It said *"Your bead is on the strand"* before anything had been confirmed. It now says the contribution joins the record when the family confirms it, and the photo caption says the same.

**One migration:** `contributions.photo_width` and `photo_height`. M4-01 computed both per derivative and stored neither. Without them four hundred lazy images each shift the layout as they land, and the alternative — a fixed aspect box — crops somebody's photo of a gravestone to fit. The dimensions are now signed into the carried photo ticket, so an edited hidden field cannot become an edited layout.

**The strand gained a link mode** for the cover: same geometry, same `<ul>`, anchors instead of submit buttons, no panels and **no motion at any archetype** — nothing has just arrived on a record.

**On sharing with the incwadi (M2-11):** beyond the strand, almost nothing, and deliberately. The incwadi lists every amount and a total because a group handing over money must account for it; the album must never carry either. One shared row component would put the one place a total belongs and the one place it must never appear in the same file. What did get shared is `formatDayMonthYear` — the incwadi held a private copy and the album needed the same thing, and a record read in five years needs the year.

**M4-02b · Message and photo on in-kind contributions** *(NEW — outstanding)*
*Deps:* M4-01, M2-04
Somebody brings the tent — the most substantial thing anyone does, and the thing the product is named for — and can leave **no message and no photo, ever**. The album therefore under-represents exactly the contribution *ukupheka* describes.

The shape is not the cash flow's. A cash contribution's row is created at the pay step, which is where M4-01 attaches the photo; an in-kind row is created **at confirm time, inside `confirmDelivery`'s transaction** (`src/db/repositories/needs.ts`), by the organiser, from a claim the contributor made hours or days earlier. So the attachment point is not on the row's creation path at all — it has to hang off the claim, which is the contributor's last contact with the system, and survive until the organiser confirms.

Options worth weighing before building: carry it on the claim (a column on `need_claims`, attached at claim time, moved across at confirm); or reach the contributor after delivery through the undo/claim capability they already hold, which is the only handle we have on somebody with no account (rule 4).
*Done:* somebody bringing something can leave a message and a photo; it appears on their album entry; the claim path still creates exactly one ledger entry.

**M4-03 · Print-ready PDF**
*Deps:* M4-02
Server-generated, correct bleed and margins. Archetype-appropriate cover.
*Done:* ~~passes a printer's preflight~~ — **partially met, see below**; generation is queued, not synchronous.

**Built.** `/e/[slug]/album/<version>.pdf` — A5 portrait, 148 × 210mm trimmed, 3mm bleed, with a MediaBox, BleedBox and TrimBox on every page. Four hundred entries render to **69 pages and 116KB in about three quarters of a second** without photographs; each photograph adds its own JPEG on top of that.

**The first criterion is partially met and marked so deliberately**, the way M2-07 left WhatsApp rendering open. A real preflight runs a printer's own profile against the file at their counter and no test here can stand in for that. What is asserted instead, against a really-generated document at one entry and at four hundred: the three boxes on every page, the 3mm bleed, every font embedded and subset with no standard-14 font referenced, images as JPEG, no transparency and no soft masks, and the metadata. **What stays unverified is the colour conversion**, which is the printer's to make — and one known deviation is asserted rather than hidden: `pdf-lib` subsets glyphs properly but names the result `PublicSans-Regular-979` instead of carrying the conventional `AAAAAA+` subset tag, which some commercial preflights flag.

**Two dependencies: `pdf-lib` and `@pdf-lib/fontkit`.** Pure JavaScript, no native binary, server-only. Printing M4-02's HTML through Chromium was rejected because it writes no TrimBox and no BleedBox and produces RGB with no way to say so — it would fail the exact criterion it existed to satisfy — and because a browser binary in production is not a small thing. The image half needed nothing new: `sharp` already decodes the AVIF a PDF cannot hold.

**No third copy of the typeface.** `src/assets/fonts/` holds WOFF1, which is an sfnt with the tables individually zlib'd, so `woffToTtf` gets to TrueType in about seventy lines with `node:zlib`. The printed album provably uses the same font file the site does.

**RGB throughout, said in words as well as in the metadata** — on the colophon page, because a colour space discovered at the press is discovered too late. South African trade printers convert to their own profile, `--ink #16233D` is a specific navy a naive CMYK build would not honour, and body text on four plates registers badly at this size.

**Queued through the existing pattern.** `pnpm render`, beside `pnpm notify` and `pnpm expire`, with an `album_renders` table and no Redis — M1-06 §4 and M2-08 §1 declined it and this task did not change the answer. Claims are conditional updates, so two overlapping runs cannot render the same album; three attempts, then the row says it gave up.

**No amount can reach the file.** `PrintableEntry` has no amount field and `PrintableBead` carries a diameter rather than a value, so the number the band was computed from never crosses into the renderer. The one number on the page is the folio — a count of pages, not of people (docs/decisions.md M4-03 §6, beside M3-07b's reasoning about report counts).

**M4-03b · A real preflight, once there is a printer** *(NEW — outstanding)*
*Deps:* M4-03
Take a generated album to an actual print shop and run their preflight against it. The structural properties are asserted in `tests/unit/album-pdf.test.ts`; what nobody has checked is how it behaves against a real ICC profile, whether the missing subset tag trips their tooling, and whether 3mm is the bleed their finishing wants.

**Not a task an agent can close** — it needs a person, a shop and a proof. It is here so that the partially-met criterion above has somewhere to land rather than reading as done.
*Done:* one album has been through a commercial preflight, and whatever it said is recorded here.

---

## Part F — Reconciling Bank Verification

The dashboard design described verifying a bank account by **sending R1 and asking for the reference**. Stitch's Bank Account Verification API instead checks the account against the holder's SA ID directly, returning `accountExists`, `identityDocumentMatch`, `lastNameMatch`, `accountAcceptsCredits` and more — no test deposit, results within 120 seconds, cached 48 hours.

**Decision: use Stitch BAV. Rewrite the dashboard copy to match.**

Rationale: no waiting for a deposit to land, no user hunting for a reference, and a materially stronger check — it confirms the account belongs to the *verified person*, not merely that someone controls it.

Replacement copy for that condition's `remedy`:
> *"Add your account number and we check it against your verified name with your bank. Usually a few seconds."*

The `protects` line as written stays — it is accurate for either mechanism.

**M3-08 must not implement the R1 flow.** Flagged here because the design file contains it and would otherwise be copied faithfully.

**Done, and it was not the only one.** M3-08 shipped Part F's replacement wording and no test deposit — and found two further untrue elements in the same file: a countdown on the bereavement variant, and a held-balance payout section with a Request button. All three are tabulated in docs/decisions.md M3-08 §2. **Treat `design/dashboard.html` as a file to check against the rules rather than copy from.**

---

## Part G — Performance Budget (restated with measured numbers)

| Component | Size | Notes |
|---|---|---|
| HTML + inline critical CSS | ~15KB gzipped | Measured 34–48KB raw across the five screens |
| Font — latin | 26.8KB | Fetched on every page |
| Font — latin-ext | 18.5KB | **Only fetched when latin-ext characters are present** — `unicode-range` makes this lazy |
| Client JS (contribution path) | ≤ 20KB | Claim interaction and flow state only |
| **Typical first load** | **~62KB** | English page, latin only |
| **Worst case** | **~80KB** | isiZulu/isiXhosa page pulling latin-ext |

Comfortably inside 150KB with room for growth.

**Two notes for the CI gate:**
1. Measure the **Next.js production build**, not the Claude Design bundle. Those files carry ~200KB of preview runtime and React that will not exist in production. The real page is the template, not the wrapper.
2. Fonts cache across navigations, so only the first page pays. Gate on first load anyway — that is the contributor's experience.

### G.1 Why the public path is a route handler, not a page — measured in M1-08

**Do not convert `src/app/(public)/e/[slug]/route.tsx` into `page.tsx`.** It will typecheck, it will render identically, and it will silently put 174KB back.

M1-08 built the page both ways and measured the production build. An App Router page with **zero client components and no interactivity** — the M1-07 stub, a title and six list items — came to:

| | gzipped |
|---|---|
| HTML | 2.8 KB |
| CSS | 1.4 KB |
| **JavaScript (6 chunks)** | **174.3 KB** |
| Font (latin) | 26.8 KB |
| **First load** | **199 KB** |

That is 33% over the 150KB ceiling before any of the real content exists. The JavaScript is Next's App Router client runtime — React, the router, the Turbopack runtime — and it ships whether or not a route has a client component. Next 16 has no configuration option that removes it; `inlineCss`, `cssChunking` and `prefetchInlining` were all checked.

The budget above was written for a page that does not ship a framework runtime: ~62KB typical, of which 26.8KB is the font, leaves ~35KB for everything else.

**So the public event page is rendered with `renderToStaticMarkup` and served from a route handler**, with the tokens and page CSS inlined into the head. Measured after the change, same production build, same fixture:

| | transferred |
|---|---|
| HTML + inline critical CSS (brotli) | 4.6 KB |
| JavaScript | **0 KB** |
| Font (latin) | 26.2 KB |
| **First load** | **30.8 KB** |
| Worst case, pulling latin-ext | 48.8 KB |

LCP on slow 3G (400kbps, 400ms RTT): **0.61s** against the 2.5s budget.

Two consequences to plan around:

- **The contribution flow inherits this.** Claiming and contributing on the public path are `<form method="post">` to route handlers or server actions. Rule 5 already required that — the claim has to work with JavaScript disabled — so this removes the option of quietly not doing it. **Noted against M2-04.**
- **Next does not compress a raw `Response` from a route handler.** It compressed the page it replaced. The handler compresses its own output (`src/lib/http-compress.ts`); without it the document ships 13.3KB instead of 4.6KB.

`pnpm gate:size` builds nothing, starts the production server, seeds a published funeral, measures what crosses the wire, measures LCP, and deletes the fixture. It fails the build on breach and names the cause. Reverting the route to a page was tried: the gate reports 198.6KB, "over budget by 66.6KB", and "the page loaded 7 script(s)".

---

## Part H — Testing Strategy

| Layer | Tool | Covers |
|---|---|---|
| Unit | Vitest | Domain logic, Money, hash chain, archetype rules |
| Integration | Vitest + Testcontainers | Repositories, constraints, concurrency, ledger integrity |
| E2E | Playwright | Contribution flow, claiming, creation, auth, payout gating |
| Visual | Playwright screenshots | All six archetypes, all primitives |
| Performance | Lighthouse CI | Budget gate, LCP on throttled 3G |
| Accessibility | axe-core in Playwright | Zero violations on public pages |

**Non-negotiable test cases:**
1. Bereavement event cannot have a target — DB, type and runtime layers.
2. Bereavement `animate` is `false`, not `undefined`.
3. Ledger tampering is detected.
4. Concurrent claims on the last unit — exactly one succeeds, the other gets the conflict branch.
5. No plaintext ID number reaches storage or logs.
6. Contribution flow completes with JavaScript disabled.
7. **No password, email or signup input exists anywhere in the contribution flow.**
8. Public event page within budget.
9. Only two woff2 files ship, latin and latin-ext.
10. `/check` is reachable without traversing an event page.
11. **A collection has no payout, float or disbursement path.**
12. **An unverified collection organiser cannot generate a share link.**
13. **A collection appears on a host event page as exactly one ledger entry, not one per member.**

---

## Part I — Definition of Done

- [ ] `pnpm typecheck && pnpm lint && pnpm test` passes
- [ ] Tests written in the same session
- [ ] No new dependency without prior agreement
- [ ] `domain/` imports nothing from `app/`, `adapters/` or `db/`
- [ ] Keyboard navigable, visible focus, axe clean
- [ ] Works at 375px
- [ ] Performance budget respected if the change touches the public path
- [ ] Copy pulled from `src/copy/`, not inlined in components
- [ ] Accent handled via `var(--accent, #16233D)`, never a conditional
- [ ] `docs/decisions.md` updated
- [ ] Committed with the task number

---

## Part J — What Is Still Open

None of these block Milestones 1–4.

1. **Legal opinion on the Stitch float** — gates Milestone 5 only. Commission now.
2. Identity vendor and pricing — gates M3-01's implementation, not its interface. **M3-01 is built:** the `IdentityVerifier` interface, an in-memory implementation, consent capture, the peppered hash and the polling UI all exist, and `identityVerifier()` refuses to construct in production until a vendor is chosen. The choice also decides one thing beyond the credential — **whether a selfie capture step exists at all.** VerifyNow and Datanamix return the Home Affairs photograph for us to compare, which means capture, upload and images we are then responsible for not keeping; Didit does liveness and face match inside its own hosted flow, so no image reaches us. `VerificationStart` accepts either shape. **No capture was built**, so M3-01's "no image reaches storage or logs" is honest today because none is captured — if the vendor chosen needs one, that criterion has to be earned again in the task that builds it rather than inherited.

2a. **A KMS for the ID pepper.** Architecture §7.3 puts it in one and M3-01 uses `ID_NUMBER_PEPPER` from the environment, the same stopgap M1-02 §5 recorded for the column key. It was on neither list. `hashIdNumber` takes the pepper as an argument, so the seam is already where it needs to be — moving it is one function in `src/lib/identity.ts`.

2b. **A real admin model.** M3-07 gates the report review queue on `ADMIN_PHONE_NUMBERS`, an environment allowlist checked against an ordinary organiser session. It is in the environment rather than in a column for a good reason — the application role holds UPDATE on `organisers`, so an `is_admin` column would be a privilege the app could grant itself — but it has no roles, no revocation short of a redeploy, no record of who granted it, and it does not scale past a handful of people. Same stopgap posture as item 2a, recorded so nobody later mistakes it for the intended design. See docs/decisions.md M3-07 §2.

3. WhatsApp BSP selection — gates M2-08's *delivery*, not its interface: the templates, the outbox, the digest rule and the flush are built and tested, and `whatsAppSender()` refuses to construct in production until a BSP exists. **An email provider and an SMS provider are open in the same way** — the SMS one has been outstanding since M1-06 §6 and belongs on this list.
4. AWS af-south-1 vs Azure SA North.
5. CIPC, domain, trademark on "Isipheko".
6. User interviews validating the public-ledger default and the needs board.

**On item 6:** M2-04, M2-06 and M2-10 are the tasks most exposed to being wrong about user behaviour. If interviews haven't happened by the time you reach them, build behind a feature flag so the default can change without a rewrite.

**Newly surfaced by the designs, needing a decision:**

7. **`isipheko.co.za/check` must exist at launch.** Load-bearing in two places. M3-05 builds it; the domain and route need reserving now.
8. **The R5,000 witness-approval threshold** was invented by the dashboard design. Make it configurable and confirm against real contribution sizes — PayShap data suggests 80% of transactions are under R500, so R5,000 may be high or low depending on total event size. **M3-08 made it `WITNESS_APPROVAL_THRESHOLD` in `src/domain/payout/balance.ts`** — a named constant and deliberately *not* an environment variable, because nothing needs to vary it yet and a setting implies it has been tuned. When there is evidence, the evidence moves that line.
9. **isiZulu and Sesotho copy in the designs needs first-language review** before anything ships publicly.
10. **Collection organiser fraud has no product-level chokepoint.** Verification-gates-sharing plus witness confirmation plus the social graph are the controls. Watch actual abuse rates once live and be prepared to add friction — a hold on link sharing for new organisers, or a member-count threshold before sharing unlocks.
11. **Standalone collections dilute positioning if led with.** Build early, market second. Revisit if collections outgrow ceremony events by more than ~3:1.
