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

- **Cash bead:** solid `var(--accent)` disc, four coarse diameters (10/14/18/24px) by band. Bands **unlabelled** so nobody reverse-engineers an amount.
- **In-kind bead:** same diameters, white fill, 2px accent ring, 2px horizontal bar across the middle. Equal visual mass — the forms differ by shape, never by prominence.
- **Group bead (collections):** a third form — a bead with a visible ring of smaller beads around it, or equivalent — opening to reveal the members inside. One bead per collection, never one per member.
- No total, no count, no target displayed.
- Each bead is a real `<button>` with a 44px hit area via padding while the visible bead stays small.
- Beads are CSS-drawn `<div>`s in declared markup, not JS-generated.
- Screen readers get the strand as a list.

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
*Done:* 100k codes, no collisions within an event; `mth-4k7b2x`, `MTH-4K7B2X` and `MTH-4KZBZX` all resolve.

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
Per-event OG image generated server-side, cached in object storage. Share sheet with pre-written message in the organiser's language. **Verified badge legible at thumbnail size** — bead colour, name and tick carry the card.
*Done:* preview renders correctly in WhatsApp on iOS and Android; generation cached, not per-request.

**M2-09 · Collections — data and rules** *(NEW)*
*Deps:* M2-01, M2-03
Schema per Part D2.8. Attached and standalone collections. Members, joining, visibility. Group in-kind claim of a need item as a unit. One ledger entry per collection, never per member.
*Done:* an attached collection renders on the host event page as a single entry; a standalone collection resolves with its archetype; a collection claiming a need item reserves the whole item atomically; **a test asserts no payout, float or disbursement path exists on a collection.**

**M2-10 · Collection page and joining** *(NEW)*
*Deps:* M2-09, M2-05
The collection page: members, running total, what they're collecting toward. Joining reuses the contribution flow — **still no account for members.** Verification gates *sharing*, not payout: no verified identity, no shareable link.
*Done:* an unverified organiser cannot generate a share link; members join without accounts; the trust panel states plainly that the organiser holds the money, not Isipheko.

**M2-11 · Handover** *(NEW)*
*Deps:* M2-10, M4-02 *(soft — album can follow)*
Witness confirmation as default. Organiser-marks-with-evidence as fallback. Optional one-tap host acknowledgement by SMS link, never required. Generates the group's album.
*Done:* handover completes with the host taking no action in the system; witness confirmation works from a contributor's phone; evidence photo EXIF-stripped per M4-01 rules.

**M2-08 · Notifications**
*Deps:* M2-05
WhatsApp utility templates via BSP adapter. **Batched digests, max one per hour to the organiser.** SMS for OTP only. Email fallback.
*Done:* 50 contributions in 10 minutes produce exactly one organiser message; template categories verified as utility, not marketing.

### Milestone 3 — Trust

**M3-01 · Identity verification adapter**
*Deps:* M1-06
Provider interface + one implementation. Async job with polling UI — never blocking, must survive a 120-second pending response. Peppered ID hashing via KMS. Selfie and DHA photo never persisted. Timestamped consent capture.
*Done:* a test proves no plaintext ID number and no image reaches storage or logs.

**M3-02 · Verified badge and publish gating**
*Deps:* M3-01, M1-07
Verification required before publish. Badge above the fold with date. `"Why can't I skip this?"` secondary action explaining the reason rather than demanding compliance.
*Done:* an unverified event cannot be published; badge appears in the OG image.

**M3-03 · Witnesses (abakhaphi)**
*Deps:* M1-07
Invite by phone, accept/decline, public display. Copy per Part D — honour, not audit. Relation hints on each slot.
*Done:* invite and acceptance work end-to-end; witnesses render publicly; nothing is sent before they agree.

**M3-04 · "Is this real?" panel**
*Deps:* M3-02
Permanent panel on every event page. Not styled as a warning. Must state that a number on the page cannot verify the page, and link to `/check`.
*Done:* present on every event page; no self-referential verification route anywhere in the copy.

**M3-05 · `/check` — independent verification route** *(NEW)*
*Deps:* M3-02
The canonical route the trust panel and verify screen both point to. Someone holding a link, a reference code, or an organiser name can confirm independently whether an event is real and verified. **Must be reachable without following a link from the event page** — that is the entire point.
*Done:* resolvable by slug and by reference code; returns verification status and organiser name; rate-limited against enumeration; exposes no personal data beyond what the event page already shows publicly.

**M3-06 · Report channel**
*Deps:* M3-04
Report form, monitored queue, acknowledgement path with an SLA.
*Done:* a report creates a reviewable record and sends an acknowledgement.

**M3-07 · Audit log and admin review**
*Deps:* M1-02
Append-only audit of every security-relevant action. Minimal internal review queue for flagged events.
*Done:* auth, publish, confirm, payout-request and report events all logged; log not mutable by the app role.

**M3-08 · Organiser dashboard**
*Deps:* M2-05, M3-03
Per `design/dashboard.html`. Confirmation queue leading the page with its empty state. Needs board from the organiser's side — claimed-not-delivered vs unclaimed. `raised / settling / available` money split. Payout conditions with `protects` and `remedy` on every condition. **Use Stitch BAV for bank verification, not the R1 deposit flow in the design file — see Part F.**
*Done:* confirm and mark-delivered are the two easiest actions on the page; every unmet condition shows a concrete next step; the 72h hold fences only the recent portion, never the whole balance.

### Milestone 4 — Album

**M4-01 · Messages and photos**
*Deps:* M2-05
Attach to a contribution. Upload limits, dimension caps, EXIF stripped, content-type validated by magic bytes not extension.
*Done:* oversized and mistyped uploads rejected; EXIF confirmed stripped; served as AVIF with WebP fallback.

**M4-02 · Album view**
*Deps:* M4-01, M2-06
Every message, photo and contribution as one readable artefact. Strand as the cover.
*Done:* renders at 1 and 400 entries; lazy-loads below the fold.

**M4-03 · Print-ready PDF**
*Deps:* M4-02
Server-generated, correct bleed and margins. Archetype-appropriate cover.
*Done:* passes a printer's preflight; generation is queued, not synchronous.

---

## Part F — Reconciling Bank Verification

The dashboard design described verifying a bank account by **sending R1 and asking for the reference**. Stitch's Bank Account Verification API instead checks the account against the holder's SA ID directly, returning `accountExists`, `identityDocumentMatch`, `lastNameMatch`, `accountAcceptsCredits` and more — no test deposit, results within 120 seconds, cached 48 hours.

**Decision: use Stitch BAV. Rewrite the dashboard copy to match.**

Rationale: no waiting for a deposit to land, no user hunting for a reference, and a materially stronger check — it confirms the account belongs to the *verified person*, not merely that someone controls it.

Replacement copy for that condition's `remedy`:
> *"Add your account number and we check it against your verified name with your bank. Usually a few seconds."*

The `protects` line as written stays — it is accurate for either mechanism.

**M3-08 must not implement the R1 flow.** Flagged here because the design file contains it and would otherwise be copied faithfully.

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
2. Identity vendor and pricing — gates M3-01's implementation, not its interface.
3. WhatsApp BSP selection — gates M2-08's implementation, not its interface.
4. AWS af-south-1 vs Azure SA North.
5. CIPC, domain, trademark on "Isipheko".
6. User interviews validating the public-ledger default and the needs board.

**On item 6:** M2-04, M2-06 and M2-10 are the tasks most exposed to being wrong about user behaviour. If interviews haven't happened by the time you reach them, build behind a feature flag so the default can change without a rewrite.

**Newly surfaced by the designs, needing a decision:**

7. **`isipheko.co.za/check` must exist at launch.** Load-bearing in two places. M3-05 builds it; the domain and route need reserving now.
8. **The R5,000 witness-approval threshold** was invented by the dashboard design. Make it configurable and confirm against real contribution sizes — PayShap data suggests 80% of transactions are under R500, so R5,000 may be high or low depending on total event size.
9. **isiZulu and Sesotho copy in the designs needs first-language review** before anything ships publicly.
10. **Collection organiser fraud has no product-level chokepoint.** Verification-gates-sharing plus witness confirmation plus the social graph are the controls. Watch actual abuse rates once live and be prepared to add friction — a hold on link sharing for new organisers, or a member-count threshold before sharing unlocks.
11. **Standalone collections dilute positioning if led with.** Build early, market second. Revisit if collections outgrow ceremony events by more than ~3:1.
