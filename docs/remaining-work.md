# Isipheko — Everything Remaining

**Status:** Plan for review. Nothing here is built.
**Written:** 29 August 2026, against a repository at `fce894e` — Milestones 1–4 complete, plus M5-01, M5-02 and M5-03.
**Companions:** `docs/implementation-plan.md` Part E (the task style this follows) · `docs/paystack-analysis.md` §5 (which this supersedes, see the numbering note) · `docs/architecture.md` §15 · `docs/decisions.md`

This document covers **everything outstanding**: the rest of Milestone 5, the carryover tasks Milestones 2–5 deferred by name, the home page that was never built, the launch work that is not code at all, and the copy that is either known to be untrue or has never been read by somebody qualified to check it.

Two conventions, both load-bearing:

- Every task is marked **READY** or **BLOCKED**. Blocked names what it waits on. A task marked ready can be started in the next session with no answer from anybody.
- Where a task cannot be scoped because an answer is missing, it says so and **stops**, rather than being written around a guess. Part H collects those. A named gap is worth more than an invented dependency.

---

## Part A — The gates, stated once

Four things gate the hosted model. Three are questions to Paystack; one is a question to a lawyer. They are `docs/paystack-analysis.md` §6 items 1–3 and are restated here because everything in Part B hangs off them.

| # | Question | To | Gates |
|---|---|---|---|
| **A1** | How is a subaccount's `settlement_schedule` set, and how is a manual settlement released? Does List Settlements report subaccount settlements? | Paystack | M5-04 through M5-11, M5-14 |
| **A2** | Does our model fall foul of the ZA MSA Section B clause 1 aggregation prohibition? Described accurately: a platform initiating transactions on behalf of private individuals hosting family ceremonies, each a subaccount, a voluntary tip as our share. | Paystack, in writing | Whether any of Part B is buildable against this vendor |
| **A3** | Are natural persons acceptable as subaccount beneficiaries, and what does the subaccount review require of us — turnaround, evidence, whether an API exists? | Paystack | M5-05, and an operational SLA the product has nowhere to put |
| **A4** | Does instructing the release of a subaccount settlement constitute accepting money for on-payment to a third person? Does the answer change under `auto` with no release trigger at all? | Payments attorney | M5-05 onward |

**A1 is the one that changes the shape of the plan rather than merely delaying it.** If a manual settlement cannot be released by us, then:

- the real adapter implements `PaymentProvider` and **cannot** implement `HeldBalanceProvider`, exactly as `PayFastProvider` cannot today;
- there is no release trigger, so **M5-09 and M5-10 have nothing to gate and nothing to reconcile**;
- the 72-hour hold and the witness approval stop being enforceable and become promises the copy must withdraw — `dashboardCopy.payout.conditions.hold` and `.witness` would be describing controls that do not exist;
- `payouts` is not reshaped, it is deleted.

That is not a smaller version of the same plan. It is a different one, and it is why no schema is migrated before A1 is answered.

**A2 is the cheapest and the most likely to end the direction.** It is one email. The same clause in PayFast's terms is why `PayFastProvider` is checkout-only (M5-01 §1). Discovering the answer after launch means discovering it as a terminated account with an unsettled balance in it.

**These four are one administrative act and should be started the same week.** They are `M5-00` in `docs/paystack-analysis.md` §5, they are not agent tasks, and nothing in Part B begins until they are filed in `docs/`.

### A.5 A numbering collision, resolved here

`docs/paystack-analysis.md` §5 numbers M5-01 through M5-13. **The repository took a different route and the numbers no longer line up.** What was built:

| Built | Content | Analysis number |
|---|---|---|
| M5-01 | Provider interface + simulator + checkout-only PayFast | M5-01 |
| M5-02 | The hosted pay step, mode branch, `beneficiaryFor` stand-in | parts of M5-05 and M5-06 |
| M5-03 | The handler — confirm and append on a verified notification | M5-03 |

The analysis's M5-02 (the vendor adapter) was skipped, because M5-01 built the seam and the simulator instead and every flow was proved against those. So the analysis's numbers for the vendor adapter and for mode-per-event are spent or stale.

**This document is the canonical numbering from M5-04 onward.** M5-07 through M5-13 keep the analysis's numbers and the analysis's content unchanged. M5-04, M5-05 and M5-06 are re-cut around what exists.

---

## Part B — Milestone 5, from M5-04

**M5-02b · The trust panel says the page cannot take money. It can.** — **READY, and it is the most urgent item in this document**
*Deps:* M5-02 (built)

`src/copy/event.ts:197`, rendered unconditionally by `src/ui/public-page.tsx:350`:

> *"Nothing on this page can take money from you yet. When contributing opens, you will be told exactly where your money goes before you send it."*

M5-02 built a hosted pay step reachable from that same page. `src/ui/public-page.tsx` **does not read `events.mode` at all** — the string is not mode-keyed, and there is no branch to key it on. So on a hosted event the trust panel tells a contributor that the page cannot take money, in the panel built to be the one thing on the page they can trust, immediately before the screen that takes it.

This is the fourth string of the class M5-13 exists to catch, and the worst of them. The three found so far were on the organiser's dashboard, where the reader is the person who set the page up. This one is read by a stranger deciding whether to trust the page at all — the analysis called it *"the most dangerous string in the change"* before it was written, and it was written anyway because `public-page.tsx` had no mode to branch on.

Rewrite mode-keyed, and say where the money actually goes: on a hosted event, to the family's own bank account through a licensed provider, and only what she chose to add comes to us. `neverBody` beside it stays exactly as written and must not regain the prototype's *"a held Isipheko account"* tail — that is still untrue and will stay untrue.

*Done:* a hosted event's trust panel makes no claim that the page cannot take money; a ledger-only event's panel is byte-identical to today; `public-page.tsx` reads `mode` from the same fact the pay step reads; `tests/unit/trust-panel.test.tsx` covers both; `pnpm gate:size` unchanged.

---

**M5-04 · The real provider adapter** — **BLOCKED** (A1, A2, A3, A4, a merchant account)
*Deps:* M5-01, all of Part A, and a live merchant account — which needs CIPC registration and a business bank account (Part E).

The only file in the codebase permitted to name the vendor. Initialize Transaction with `channels` ordered `capitec_pay, eft, card, qr` — cheapest and least reversible first (analysis §1.6). Resolve Account plus List Banks filtered on `enabled_for_verification`. Create-then-Update subaccount as **one operation that is not complete until a Fetch reads back the schedule and `is_verified`** (§1.3, §1.4). `Money` converted to subunits at this boundary and nowhere else. HMAC SHA512 over the raw body, verified before parsing; `200` returned before any work; source IPs checked. The outbound payload allowlist from §2.8 enforced in code, not by convention.

**Which interface it implements is decided by A1 and cannot be decided here.** Under a manual schedule the provider holds a balance for a beneficiary, which is `HeldBalanceProvider` exactly. Under `auto` it does not, and the adapter is a `PaymentProvider` that must fail to typecheck into the wide one — the property `tests/unit/payments-provider.test.ts` already asserts for PayFast.

*Done:* every call exercised against the sandbox, not reasoned about; a test asserts the initialize payload carries no contributor name, phone, message or real email address; the `settlement_bank` / `bank_code` documentation contradiction (§1.1) is resolved by experiment and the result recorded; the domain-boundary test gains rule 10's second half and is proved to fail on a deliberate import of the vendor client from `src/domain/`; `paymentProvider()` returns it in production and the simulator's three refusals (M5-01 §11) still hold.

---

**M5-05 · Beneficiary onboarding, and the end of the organiser-id stand-in** — **BLOCKED** (M5-04, A3, A4)
*Deps:* M5-04, M3-01

M5-02 §1 says plainly that the beneficiary reference is the organiser's id and that this is a stand-in, not a design. This is where it ends. `beneficiaryFor` in the pay-step route is one function; replacing it is one function, and nothing else in the flow knows what a beneficiary is.

The organiser's screen for adding a bank account, on `/manage/[id]` beside the pay-details screen. Resolve the account, compare the returned name to the Home Affairs-verified name from M3-01, and **treat a mismatch as human review, never as a refusal** — the comparison is fuzzy in every way that matters (initials against full names, married names, a joint account in a husband's name), and refusing a grieving family over a middle initial is the failure this product cannot afford (§1.9). Store in `bank_accounts`: encrypted number, the resolve response in `bav_result` as immutable evidence, the subaccount code and `is_verified`.

**`is_verified` is a second fact and not a synonym for the first.** A subaccount can exist, resolve to a matching name, and still be unable to receive a first settlement because nobody at Isipheko has clicked Verify in the vendor's dashboard. `PayoutFacts.bankVerified` becomes two named facts. Telling an organiser her account is verified while her first payout is queued behind our internal review is the M1-08 §5 failure on the screen where money is counted.

*Done:* an organiser can add an account and see honestly which of the two facts are true; a mismatched name reaches review rather than a dead end; no account number reaches any log; a test proves the plaintext number never leaves the encryption helper; the hosted pay step settles to a real beneficiary and `beneficiaryFor` no longer returns an organiser id.

**Carries an operational commitment with no home yet.** Every new organiser and every corrected typo joins a queue a person must clear. That is an SLA on the same footing as M3-06's one working day, and the product has nowhere to put it — see Part E.

---

**M5-06 · The mode switch, replacing the SQL flip** — **BLOCKED** (M5-05)
*Deps:* M5-05

`events.mode` is flipped by hand in SQL today and no screen sets it (M5-02 §1). The reason it was left that way is the design constraint here: **the moment an organiser is payable is the moment the event can be hosted — one decision, not two.** So this is not a toggle on a settings screen. It is the consequence of M5-05 completing, offered on the event's own screen, with what it changes stated before it is taken.

A hosted event's pay step **keeps the direct-pay instructions beneath the hosted route**, because PayShap is not a vendor channel and is the cheapest rail on a R50 contribution (§1.6). A contributor who cannot or will not use a card must still be able to give.

**Whether the switch is one-way is not decided.** The analysis says one-way (§2.2). An event that goes hosted and then loses its beneficiary — a closed account, a failed review — has contributors mid-flow. That is a state nobody has designed.

*Done:* an organiser with a verified beneficiary can host her event from a screen; a ledger-only event is byte-identical to today; `pnpm gate:size` unchanged on `/e/[slug]`; the SQL flip is not needed by any test.

---

**M5-07 · The tip** — **BLOCKED** (M5-04 for the sandbox edges, and a revenue decision that is ours)
*Deps:* M5-04, M5-06

On the **amount step**, not the pay step — the pay step is the moment of commitment and the last thing before leaving our origin, and a second money decision there is where dark patterns live. Mechanically it must be known before Initialize Transaction is called, so it cannot be a decision made at the redirect. Shown again on the pay step as a line in the total, never as a control.

**Never pre-selected, never a default, never a percentage.** Fixed small rand amounts, a custom field, and a decline option that is not phrased as a refusal — *"Just my contribution"*, not *"No thanks"*. Archetype-keyed wording; on bereavement the block wears the plainest words it has.

Taken as `transaction_charge` with `bearer: "account"` — we absorb the vendor fee, so that **the ledger can say what the family received** without a fee line an organiser reads on the day of a funeral. `contributions.tip_amount_cents`, nullable, **outside the hash chain**. The ledger's fixed test vector must not change.

*Done:* a contribution with a tip produces a ledger entry for the contribution alone; a scan asserts no tip amount renders on the event page, the strand, the album, the incwadi, the PDF, the collection page or the dashboard; the declined-tip branch is tested against the sandbox rather than reasoned about; the three edges in §4.2 — `transaction_charge: 0`, `bearer` with a zero share, and minimums — are settled by experiment before any copy is written.

**Not scopeable yet:** whether the tip can carry the cost at all. A no-tip contribution loses us 2–2.9% plus a rand. Part H.

---

**M5-08 · The last untrue label on the money section** — **READY**
*Deps:* none beyond what is built

Two of the three money strings M3-08 shipped as Mode A truths have been fixed: `money.intro` at M5-03 §7, and `money.raisedNote` — *"confirmed by you"*, on a screen where the payment confirmed it and she never saw the row — in the commit preceding this document. **`available` is the third and last on this screen.** (M5-02b is the fourth of the class, on a different screen and a worse one.)

It reads *"Settled"*, with `availableNote` explaining that the amount is *"past the window in which a payment can be reversed"*. On a hosted event "Settled" sounds like *in your bank* and means *past the reversal window*. Two different facts wearing one label, on the figure an organiser acts on.

**The honest hosted label today names one fact, not two.** Nothing moves money out on a hosted event — `payouts` is empty and M5-03 §5 explains why it must stay that way until there is a payout row to explain a debit. So *paid to your bank* is never true yet, and the hosted variant should say only what is true: past the reversal window, still with the payment service. **The second fact arrives with M5-10** and is a one-line addition then, not a rewrite.

This is deliberately smaller than `docs/paystack-analysis.md` §5's M5-08. The rest of that task — `payout.intro` becoming a form, `conditions.bank.notYet` and `conditions.witness.notYet` being deleted — describes conditions that do not exist until M5-05 and M5-09, and writing their copy now would be inventing it.

*Done:* no figure on either variant reads as money she has when it is money she is owed; M3-08 §1's no-request-button test survives for both modes; the funeral countdown scan (M3-08 §2) still passes; the mode-keying reads the same `facts.mode` the two sentences above it read.

---

**M5-09 · The payout gate — conditions, request, audit** — **BLOCKED** (A1, A4, M5-05)
*Deps:* M5-08, M5-05, M3-03

`payoutReady` gains its first caller — M3-08 §5 built it and then asserted nothing calls it. `bank` splits into the two facts M5-05 produces. `RESERVED_PAYOUT_ACTIONS` in `src/domain/audit/actions.ts` stop being reserved: `payout.requested`, `payout.approved` and `payout.released` become real, in the two-actor shape that file already anticipates. Witness approval above `WITNESS_APPROVAL_THRESHOLD` becomes a real approval with a real consequence. `payouts` is reshaped from Stitch's disbursement states to a settlement release request — what was asked for, when, on whose approval, drawing which fenced portion.

*Done:* every one of the four conditions still has a state in which it is unmet; a request below the threshold needs no witness and one above it cannot proceed without one; every step is audited; the request is idempotent under a double tap; re-authentication is required regardless of session age (architecture §10).

**The threshold is R5 000 and was invented by a design file** (Part J item 8). It stops being decorative here and starts stopping payouts. It needs a number somebody has defended.

---

**M5-10 · Settlement reconciliation** — **BLOCKED** (A1, and whether List Settlements reports subaccount settlements at all)
*Deps:* M5-09

There is no settlement webhook (§1.7), so this is a polled job beside `pnpm notify`, `pnpm expire` and `pnpm render` — the pattern M2-08 §1 established and M4-03 §8 reused, still with no Redis. Reconciles requested releases against List Settlements and writes the ledger **debit** when one lands. Two overlapping runs cannot double-write, by the same conditional-claim mechanism M4-03 uses.

*Done:* a settled release writes exactly one debit; an unsettled one says so without guessing; the dashboard's *paid to your bank* fact becomes true and is added to M5-08's label.

**If List Settlements does not report subaccount settlements, there is no way to learn that an organiser was paid** and this task does not exist in this shape. Part H.

---

**M5-11 · Disputes and reversals** — **BLOCKED** (M5-04 for the vendor's event names)
*Deps:* M5-04, M5-03

`charge.dispute.create` and `charge.dispute.resolve`. A dispute resolved against us reverses a contribution that is already on the chain — a **`reversal` entry pointing at the entry it reverses** (M2-01 §6), never an edit. This is the first time in the product's life that something outside it can reverse a ledger entry.

The organiser is told, in the *protects* voice, what happened and what it means. **The copy must not imply she owes us money**, because whether she does is a question this task does not answer.

The simulator gains a reversal, which M5-01 §18 deliberately left out until there was a flow that needed one.

*Done:* a reversal arriving three weeks after the fact leaves the chain verifiable; the reversed entry is absent from the album (M4-02 §4) and from `splitBalance`; the dispute rate is reportable, because 1% costs us card acceptance entirely (§1.8).

**One property inside this task can and should be proved today**, against a hand-written reversal and no provider at all: that a late reversal leaves the chain verifiable and vanishes from both the album and the balance. It is the assertion most likely to be skipped when this task is finally built under time pressure, and M4-02 §4's exclusion has never been tested with a reversal that arrives after the album was read.

---

**M5-12 · Collections — the asymmetry said plainly, and the tripwire widened** — **READY**
*Deps:* none

Two halves, and the second is the reason this is ready rather than blocked.

**The sentence.** Once a contributor can pay with a card on an event page, *"why can't I do that here?"* becomes a question the collection page has to answer, and silence reads as a page that is broken rather than a page that is honest. One sentence, in the same voice as `collectionCopy.custodyTitle`, explaining that this money is hers and never touches us. It is the only collection copy change in the entire hosted model.

**The tripwire.** `tests/integration/collections-no-money-path.test.ts` is widened to catch `subaccount`, `paystack`, `split_code` and `beneficiary` in both the forbidden-column pattern and the code scan — **now, before the temptation exists.** Giving a collection organiser a subaccount so members can pay on her page is the obvious next idea; it is precisely us collecting money for on-payment to a third person, and it would put a private individual inside the aggregation clause of A2. It must be refused by a failing test before somebody has the idea.

*Done:* the collection page answers the question a contributor will now have; the custody scan at `collection-page.test.tsx:110` still passes unchanged; a `createCollectionSubaccount` function fails the suite, verified the way M2-09 §7 verified the last one — by adding the forbidden thing and watching the test go red.

---

**M5-13 · The untrue-string scan** — **READY to write, closes last**
*Deps:* logically M5-05 through M5-12; practically it can be written now and will pass

Not a copy sweep at the end — every task above ships its own copy. This is the **test that stops the next task reintroducing what these removed**: a scan asserting that no string reachable from a hosted event claims the contributor pays the organiser directly, that no string claims Isipheko holds money, and that no string on any surface promises a settlement timetable. In the shape of M3-08 §2's countdown scan, **with comments stripped**, so that an explanation of an absence does not satisfy it.

Writing it now costs one session and would fail immediately on M5-02b, which is the argument for doing it early rather than late. **Four strings of this exact class have now been found one at a time, after the fact, by four separate readings** — M3-08 §2, M5-03 §7, the `raisedNote` fix, and M5-02b in the audit for this document. Every one of them was found by a person looking, and the fourth had been predicted in writing before it shipped. A scan is what stops the fifth.

*Done:* the scan fails on a deliberately reintroduced *"already in your own account"* on a hosted event, on a reintroduced *"confirmed by you"*, and on M5-02b's sentence before it is fixed.

---

**M5-14 · The three payout notification templates** — **BLOCKED** (M5-09, and a WhatsApp BSP)
*Deps:* M5-09, a BSP credential

Architecture §8.2 has three payout rows with no templates. M2-08 declined to write them because Mode B was gated and *"a template that looks reviewed but has never been exercised is worse than an obvious gap"*. The registry is shaped so they slot in. **Payout reversed goes by WhatsApp and SMS**, which is the only row in the matrix that does.

*Done:* three utility templates, categorised as utility and not marketing, exercised against a real payout in a sandbox; the digest rule is untouched, because none of these three is digestible.

---

**M5-15 · The `post`-shaped checkout screen** — **BLOCKED** (a provider that answers `post` and that somebody can reach)
*Deps:* M5-04

`PayInRedirect` has two shapes because providers genuinely differ: a URL to follow, or a form to post. The flow currently refuses the second with `checkout-unavailable` rather than half-building it, because honouring it means a screen saying where somebody is about to be sent, in words somebody has reviewed against a real flow (M5-02 §4). About half a session. It belongs to the first task that has a `post` provider anybody can reach — which may be never, if the chosen vendor answers `follow`.

*Done:* a contributor sees where they are about to be sent, in reviewed words, and the path works with JavaScript disabled.

---

## Part C — The carryovers

Eight tasks that earlier milestones deferred by name — four ready, four needing a person, a decision, or a public URL — plus two added by the UX audit of 30 August 2026 (M2-09b, M2-09c, at the end of this part).

**M3-07b · Review queue pagination** — **READY**
*Deps:* M3-07 (built)

`reviewQueue` takes 100 in `src/db/repositories/report.ts`, ordered by the deadline somebody was promised, and the screen says nothing about it. A reviewer who scrolls to the bottom of a silently-capped list believes they have seen everything — so **the SLA fails invisibly, on the one screen built to guarantee it**, and the reports that fall off are the newest ones, whose deadlines have not yet arrived. Found by two E2E tests failing against a local database that had accumulated 108 open reports.

Either paginate, or show how many there are and say plainly that more exist below the cut. What must not remain is a bottom that looks like the end and is not. A count here is a count of reports, not of contributions — rule-free, unlike the album and the strand.
*Done:* a reviewer can reach every open report; no list terminates without saying whether it is complete.

**M4-01b · Handover evidence photo** — **READY**
*Deps:* M4-01 (built)

Where M2-11's deferral lands. `collections.handover_evidence_key` exists and is unused. The pipeline it was waiting for is built and reusable — `acceptPhoto` in `src/lib/contribution-photo.ts` — so this is the organiser-authenticated surface, not a second stripper: the upload control on the collection handover screen, `src/copy/collection.ts` rewritten from *"a photo will be part of this later"*, and `tests/unit/handover.test.ts:140` inverted from asserting the copy claims no photo to asserting it claims one and can take it.

Kept separate from M4-01 deliberately: a different surface with its own authorisation, changing what a collection record **claims about its own provenance**, which deserves its own mutation checks rather than riding along with a contributor-side upload.
*Done:* an organiser can mark a handover with a photo; the record says it was her word with evidence rather than a witness's tap; the copy no longer promises a later.

**M4-02b · Message and photo on in-kind contributions** — **READY, but carries an undecided design choice**
*Deps:* M4-01, M2-04 (both built)

Somebody brings the tent — the most substantial thing anyone does, and the thing the product is named for — and can leave **no message and no photo, ever**. The album therefore under-represents exactly the contribution *ukupheka* describes.

The shape is not the cash flow's. A cash row is created at the pay step, which is where M4-01 attaches the photo. An in-kind row is created **at confirm time, inside `confirmDelivery`'s transaction**, by the organiser, from a claim the contributor made hours or days earlier. So the attachment point is not on the row's creation path at all. Two options, and **neither has been chosen**: carry it on the claim (a column on `need_claims`, attached at claim time, moved across at confirm), or reach the contributor after delivery through the undo/claim capability they already hold, which is the only handle we have on somebody with no account.

**Choose before the session starts, not during it.** The second option is a message we cannot send until a BSP exists (Part E); the first works today.
*Done:* somebody bringing something can leave a message and a photo; it appears on their album entry; the claim path still creates exactly one ledger entry.

**M2-10b · Need items with a real cost** — **BLOCKED on a product decision that is ours**
*Deps:* M1-07, M2-10

`design/collection.html` computes *"The tent costs R1 200 and we have R900. Still R300 short"* from an item's cost. A need item carries the organiser's free text — *"Around R1 200 to hire"*, *"Mealie meal, rice, sugar, oil"* — rather than a number (M1-07 §3). Parsing that into arithmetic on a page whose subject is money, where being wrong tells a group they are short when they are not, was refused at M2-10.

It needs need items to carry a real cost, which is a separate decision with its own cost: a second field on every item at setup, on the screen where an organiser is already answering the most questions in the product, for a line that appears on one page. **Nobody has decided whether that trade is worth making.** Until somebody does, this is not a task, it is a question.

**M3-05b · Resolving `/check` by organiser name** — **BLOCKED on a design decision**
*Deps:* M3-05 (built inside M3-04)

M3-05's spec offers resolution by organiser name and it is not implemented. A name is not unique, so it is a search rather than a lookup — and a search over organiser names on an unauthenticated endpoint is a way to ask **which people have set up an umcimbi**, which on a funeral is a question about a bereavement nobody consented to publish. It needs a deliberate design (exact match only? paired with a second field? a rate limit that survives enumeration?) rather than a `contains` query. Read `docs/decisions.md` M3-04 §7 before picking it up.

**M2-07b · WhatsApp link preview on two real phones** — **BLOCKED on a public URL**
*Deps:* M2-07 (built), a domain

*"Renders correctly in WhatsApp on iOS and Android"* was never met. WhatsApp's crawler fetches from the internet and cannot reach a development server. The automated half is `tests/e2e/og-image.spec.ts`; the device checklist is in `docs/decisions.md` M2-07. **Not a task an agent can close** — it needs a public URL and two real phones.

**M4-03b · A real preflight, once there is a printer** — **BLOCKED on a print shop**
*Deps:* M4-03 (built)

Take a generated album to an actual print shop and run their preflight against it. The structural properties are asserted in `tests/unit/album-pdf.test.ts`; what nobody has checked is how it behaves against a real ICC profile, whether the missing `AAAAAA+` subset tag trips their tooling, and whether 3mm is the bleed their finishing wants. **Not a task an agent can close.**

**M1-10 · Copy-layer leaks, and one claim that stopped being true** — **READY**
*Deps:* none

Four small things, found together, all of the same family: `src/copy/` is the translation unit (Part D, rule 11) and anything user-facing outside it is a string a translation pass will miss.

1. **`src/domain/archetype/archetypes.ts` holds seven user-facing isiZulu kickers** — `Umshado`, `Umembeso`, `Umngcwabo`, `Umbuyiso`, `Imbeleko`, `Umgidi`, `Itiye` — and its own doc comment says so: *"These are user-facing strings in `src/domain/`, which sits awkwardly against rule 11… see `docs/decisions.md` M1-04 for where they go when `src/copy/` lands."* `src/copy/` landed. They did not move.
2. **Two strings are inlined in components**: `Abakhaphi` at `src/app/(organiser)/manage/[id]/page.tsx:266`, and `Set up your umcimbi` at `src/app/(organiser)/account/page.tsx:44`.
3. **`src/copy/share.ts:69` says a sentence is not shipped, and it is.** *"Every person who opens it sees your verified name"* was withheld at M2-07 because the badge was a slot that drew nothing. M3-02 made the badge real, and the sentence ships — from `src/copy/setup.ts:246`. The doc comment saying otherwise, and the unused `introVerified` kept beside it, are both stale. In this codebase a doc comment is where the reasoning lives, and a stale one is worse than none.
4. **`.env.example` ships PayFast's public sandbox credentials.** They are PayFast's own published test values and harmless, but `OBJECT_STORE_DIR` is read at runtime and is **not in the Zod schema** — which quietly exempts one variable from M1-01's refusal-to-start guarantee. Fixed with OPS-09.

*Done:* no user-facing string outside `src/copy/`; the archetype config reads its kicker from the copy layer; `share.ts` says what is true; `pnpm gate:size` unchanged, because none of this crosses the wire differently.

**M5-01b · A real ITN from PayFast** — **BLOCKED on a public URL and a person**
*Deps:* M5-01 (built)

Expose a development server publicly, complete a payment in PayFast's sandbox, and let PayFast post a real Instant Transaction Notification to `/api/payments/payfast`. The outgoing signature direction is confirmed against their server by `pnpm check:payfast`; the incoming direction is **reasoned, not observed** — nobody has checked whether our incoming parameter string matches what their server signed. **Not a task an agent can close.**

**Worth saying, because it changes the priority:** if the chosen vendor is not PayFast, this task verifies an adapter nothing will use. It is cheap and it closes a criterion honestly, but it should not sit ahead of anything on the launch path.

**M2-09b · Group in-kind claiming has no screen** — **READY, and deserves a session of its own** *(added 30 August 2026, from the UX audit)*
*Deps:* M2-09, M2-10 (both built)

`claimAsGroup` — eight cousins claiming the tent as a unit, Part D2.5's *"how families actually operate"* and the differentiator that separates an attached collection from a group pot — is built, tested, and **called from no screen**. The collection organiser's page offers no way to take an item off the host's list, so the *"claimed by us"* card on the collection page, the incwadi's *"what the group took off the family's list"* line, and the group claim's own no-expiry rule (M2-09 §3) are all machinery with no door. The M3-08 §8 shape, on the feature the product's positioning leans on.

Deliberately **not** built as a tail-end audit fix: which items are offered (the host's open items, resolved through `collections.event_id`), what the group sees before committing (a claim is all-or-remainder, M2-09), and what the release path is when plans change are one coherent design, and UX-05 already decided the host cannot release a group's claim — so the release half below is this task's sibling, not an afterthought.
*Done:* an attached collection's organiser can claim an open item from the host's board as the group; the claim carries the collection id and does not expire; the collection page and incwadi say so; abandonment (M2-09c) releases it.

**M2-09c · Abandoning a collection** — **READY, same session as M2-09b** *(added 30 August 2026, from the UX audit)*
*Deps:* M2-09

`abandonCollection` and `withdrawMember` have no callers. A collection that fizzles has no end: it sits open forever, a mistaken join sits on the roster forever (*"Not marked off yet"*, indefinitely), and — once M2-09b exists — an abandoned group claim would hold the host's tent with nothing to release it, because a group claim never expires and M2-09 §3 names abandonment as the only thing that gives the item back. The copy consequences are real: what an abandoned collection's public page says, and to whom, has not been designed, which is why this is a session and not a commit.
*Done:* an organiser can close a collection that will not hand over; members can be removed before money is marked; an abandoned group claim releases the item; the page says what happened in words somebody has reviewed.

---

## Part D — M1-09, the home page

**M1-09 · The home page** — **READY**
*Deps:* M1-05, M1-08's route-handler posture, `src/copy/home.ts`

`src/app/page.tsx` renders `<main>Isipheko</main>` and carries a comment saying not to grow it. Somebody typing the domain today lands on the word and nothing else. **This is the only screen in the product a stranger reaches without a link**, and it is the one screen the product does not have.

**What it must do**

1. **Explain what this is, in the words of the custom.** *Isipheko* from *ukupheka*, to cook: the custom is about bringing provisions, not cash. In-kind is not a feature list item — it is the reason the word is the name. Somebody who has never heard of us must finish the page knowing that guests bring money **or** things, and that the record of who stood with the family is the product.
2. **Route into the two things a person can start**, and in the right order. *Set up your umcimbi* first; *Start a collection* second and quieter. Part D2.7 is explicit — collections are how people arrive and the ceremony is why they stay, and a group-pot app that also does ceremonies is undifferentiated.
3. **Link `/check`, prominently and by its literal address.** It is load-bearing in two places already (M3-04, M3-05) and this is the third: somebody who was sent a link they distrust, and who correctly refuses to use a number on the page that link opened, has to be able to get to `/check` from the front door.
4. **Say plainly what we hold and what we do not.** On a hosted event the money is with the payment service; on a ledger-only event and on every collection it never touches us at all. The one dishonest thing this product could ship is a front page implying custody it does not have.
5. **Route to `/report`.** A monitored channel with a stated SLA is a differentiator when 57% of South Africans who report a scam hear nothing back, and it belongs where a stranger can find it.
6. **Carry a 404 with it.** There is **no `not-found.tsx` anywhere in `src/app/`**. A link that resolves to nothing is the scam case — it is the exact situation `/report` was built to take and `/check` was built to answer (M3-06), and today it produces Next's default page, which explains nothing and offers nowhere to go. The 404 says what happened, and points at `/check` and `/report`. It is one file and it belongs in this task because it is the same audience: somebody who arrived from outside, holding something they cannot verify.

**Constraints that are not negotiable on this page**

- **Route handler, not a page.** Part G.1 measured 174KB of App Router client runtime on a page with zero client components. `/e/[slug]` is a route handler for that reason and this is the same public path with the same budget.
- **No archetype, therefore no accent.** The home page belongs to no ceremony, declares no `--accent`, and renders indigo through `var(--accent, #16233D)`. That is rule 2 working with zero extra code, and it is the cleanest demonstration of it in the product.
- **No target, no counter, no progress, no motion, nothing celebratory.** A funeral is one of the six archetypes and the front door is read by people arriving from one. No "R2.4m raised", no event count, no testimonials.
- **This is the one public page that should be indexed.** Every event page carries `X-Robots-Tag: noindex` because a death in the family must not be findable on Google (architecture §10). That rule is about `/e/`, `/c/` and the organiser routes — **not about the domain root**, which nobody can find otherwise. A test should assert the asymmetry in both directions, because it is exactly the kind of thing a later blanket header would quietly break.

**One thing that needs deciding in the task, not before it:** both calls to action land on `(organiser)` routes that redirect to `/sign-in`, and `/sign-in` has no return path. An unauthenticated visitor tapping *"Set up your umcimbi"* is currently dropped at a phone-number field with no explanation of what they were doing. Either the first step of creation becomes public — the archetype choice writes no row and holds no personal data, so it could be — or `/sign-in` learns to carry a destination. The second is smaller.

*Done:* a stranger can explain, after reading it, what the product does and who holds the money; both creation routes are reachable without a dead end at sign-in; `/check` is reachable by its literal address; a 404 exists and points somewhere useful; zero JavaScript; within the 150KB budget measured by `pnpm gate:size`, which gains the route; axe clean; works at 375px; every string in `src/copy/home.ts`; indexable while `/e/[slug]` stays `noindex`, asserted both ways.

---

## Part E — Everything before a real person can use this

Nothing in this part is optional and most of it is not code. Each row says whether it is a **build task**, a **credential**, or an **administrative act** — and what it blocks. Ordered by what blocks the most.

### E.1 Credentials and vendor choices

| # | Item | Kind | Blocks | Note |
|---|---|---|---|---|
| **E1** | **SMS provider** | Credential | **Every organiser action in production.** Phone OTP is the only authentication there is (M1-06). No SMS means no login, therefore no event, no collection, no verification, no dashboard, no confirmation. Also the M2-11 host acknowledgement and M3-06's report acknowledgement. | Outstanding since M1-06 §6. `smsSender()` refuses to construct in production. The adapter is built; this is a key and a sender ID. |
| **E2** | **Identity vendor** | Credential **+ a decision that may create a build task** | Publishing any event (M3-02) and issuing any collection link (rule 13). Without it the public surface has no content. | VerifyNow ~R29.90, Didit ~$2.95 for DHA or ~$0.33 for the bundle, Datanamix unpriced. **The choice decides whether a selfie capture step exists at all** — VerifyNow and Datanamix return the Home Affairs photograph for us to compare, which means capture, upload, and images we are then responsible for not keeping; Didit does liveness and face match inside its own flow, so no image reaches us. `VerificationStart` accepts either shape. If the chosen vendor needs capture, M3-01's *"no image reaches storage or logs"* has to be **earned again** in the task that builds it, not inherited. |
| **E3** | **Object storage, `af-south-1` or equivalent** | Credential | Photos (M4-01), OG images (M2-07), album PDFs (M4-03), handover evidence (M4-01b). Every image surface in the product. | Depends on E6. **`objectStore()` is the one factory that does not refuse in production** — see OPS-09, which is the sharpest gap found writing this document. |
| **E4** | **WhatsApp BSP** | Credential **+ administrative act** | All notifications (M2-08 is built and refuses in production), every share message, M5-14. | Meta Business verification and per-template category approval are the administrative half and have a lead time. Templates must be **utility, never marketing** — category is assigned in Business Manager and decides the rate. Budget at post-1-October-2026 rates, which is now five weeks away. |
| **E5** | **Email provider with EU/ZA processing** | Credential | The organiser and witness fallback for every notification row. **Not a contributor fallback** — a contributor has no address and is never asked for one (M2-08 §3). | |
| **E6** | **Hosting region: AWS `af-south-1` vs Azure SA North** | Decision → administrative act | E3, and all of E.2. POPIA s72 residency is structural, not a policy document. | Architecture §3 says decide on a latency test and ZAR billing. **The latency test has not been run.** |
| **E7** | **Payment provider merchant account** | Credential, downstream of an administrative act | All of Part B. | Needs E8 and a business bank account. Sandbox keys can be had earlier and A1's questions do not wait for a live account. |

### E.2 Infrastructure — build tasks, none of which exist

There is **no CI, no Dockerfile, no infrastructure as code, and no deployment of any kind.** `compose.yaml` is a development Postgres. This is the largest unstated gap in the repository, because several rules are written as though automation enforces them and nothing does.

| # | Task | Kind | Blocks | Note |
|---|---|---|---|---|
| **OPS-01** | **CI pipeline** — typecheck, lint, format, unit, integration on Testcontainers, E2E, `pnpm gate:size`, axe | Build task | Nothing, and that was the problem | ~~**CLAUDE.md rule 9 says "CI fails the build on breach". There is no CI.**~~ **Done.** Four jobs, verified by running all four sequences locally. `pnpm format:check` joined at OPS-01b, after the seventeen unformatted Milestone 4 files were reformatted in a commit of their own — a gate that is red on arrival teaches people to ignore gates. |
| **OPS-02** | **Deploy target and infrastructure as code** | Build task | OPS-03, OPS-04, OPS-06, OPS-07, and everything in E.1 that needs somewhere to run | Blocked on E6. Architecture §12 says IaC from day one; day one has passed. |
| **OPS-03** | **The scheduled runners** | Build task | Notifications, expiry, album rendering, and **nightly ledger verification** | `pnpm notify` (hourly), `pnpm expire` (daily), `pnpm render`, `pnpm verify:ledger` (nightly, with a **hard alert** on mismatch — architecture §13). All four are manual scripts today. Nothing runs them. An unrun `verify:ledger` is a tamper-evidence claim nobody is checking. |
| **OPS-04** | **A KMS for the ID pepper and the column encryption key** | Build task + credential | Anything real being stored | Architecture §7.3 and §10 both assume a KMS; both are environment variables (`ID_NUMBER_PEPPER`, the column key). `hashIdNumber` takes the pepper as an argument, so the seam is already right — moving it is one function. Part J item 2a. |
| **OPS-05** | **A real admin model** | Build task + a design decision | The report review queue, and therefore M3-06's one-working-day promise | `ADMIN_PHONE_NUMBERS` is an environment allowlist checked against an ordinary session. It is in the environment for a good reason — the app role holds UPDATE on `organisers`, so an `is_admin` column would be a privilege the application could grant itself — but it has no roles, no revocation short of a redeploy, and no record of who granted it. Part J item 2b. **It also defaults to empty and is optional in production**, so a deployment that forgets it starts cleanly and nobody can open the review queue at all — the SLA fails with no error anywhere, which is M3-07b's failure mode one layer up. |
| **OPS-06** | **Observability, error tracking with PII scrubbing, alerting** | Build task | Knowing anything is wrong | Architecture §13's paging list: webhook lag, ledger hash mismatch, identity provider unavailable. Sentry self-hosted or EU region — POPIA s72 applies to stack traces containing personal data. |
| **OPS-07** | **Backups and a restore drill** | Build task + administrative act | Nothing until it blocks everything | An append-only ledger whose only copy is one database is not tamper-evident, it is fragile. |
| **OPS-08** | **Cloudflare in front, WAF and edge rate limiting** | Build task + credential | Nothing structurally; the rate limits it should carry are in memory today | M3-05's rate limit says in its own words that the edge half is the one that works for a public read. |
| **OPS-09** | **Object storage is a cache, and a photograph is not cacheable** | Build task | Every image the product asks somebody to trust it with | **READY, and this one loses data rather than degrading.** `objectStore()` is the only factory that does not refuse in production: it logs one warning and writes to local disk. Its doc comment justifies that — *"a missing OG cache costs a redraw, not a person waiting for a code that never comes"* — and that reasoning was written before M4-01 put **contributor photographs** in the same store, and before M4-03 put album PDFs there. M4-01 §"The original is never stored" is deliberate and correct: only the four re-encodes exist, because keeping the source would keep the GPS with it. **So a photograph that reaches local disk on one instance is gone** — on the next deploy, or immediately for any request routed elsewhere. Make it refuse in production like its five siblings, and put `OBJECT_STORE_DIR` in the Zod schema so it stops being the one variable exempt from M1-01's refusal-to-start guarantee. |
| **OPS-10** | **The E2E suite flakes under `next dev`, and the fix is a production build** *(added 30 August 2026, from the UX audit)* | Build task | Trust in the `e2e` CI job — a suite people re-run is a suite people stop reading | Roughly one full run in three drops a **single, different test each time** — an axe check, an OG fetch with `ECONNRESET` — under 16 parallel workers against `next dev`, and every affected test passes in isolation and on rerun. This is dev-server contention, not the tests: on-demand compilation and the dev overlay competing with sixteen browsers. **Run the E2E suite against a production build rather than capping workers.** Capping hides the contention without removing it and slows every run to buy the concealment; a production server is what contributors meet anyway, and the `budget` job already proves the build works in CI. The cost is the build time in the `e2e` job, which the `budget` job already pays — the two could share it. Until then, a single red test that passes on rerun is this, and M2-08b §6's warning applies: a suite that teaches people to re-run is a suite people stop believing. |

**A note that saves an afternoon:** `pnpm build` under `NODE_ENV=production` requires `DATABASE_URL` **and** `MIGRATION_DATABASE_URL` exported, even though a build touches no database — `next.config.ts` loads `src/lib/env.ts`, and in production there are no defaults and `.env` is not read (M1-01 §6, working as designed). Anybody reproducing `pnpm gate:size` locally the way CI runs it needs both in the environment alongside the three generated secrets and `NEXT_PUBLIC_APP_URL`, or the build refuses with the two variable names and no further clue that the refusal is the boot guard doing its job.

### E.3 Administrative and legal acts

| # | Item | Kind | Blocks |
|---|---|---|---|
| **L1** | **CIPC company registration** | Administrative act | E7 (a merchant account needs a registered ZA business), a business bank account, L3, and every processor agreement |
| **L2** | **The domain — `isipheko.co.za`** | Administrative act | `/check` being real at the address the product tells people to type; OG images and WhatsApp previews; M2-07b; M5-01b; the sending domain for E5; the undeliverable receipts domain the payment adapter needs (§2.8) |
| **L3** | **Information Officer registration** with the Information Regulator | Administrative act | Lawful operation. Not a technical dependency and not optional. |
| **L4** | **PAIA manual, published** | Administrative act + a build task to serve it | Same. Must be separate from the privacy policy. |
| **L5** | **Privacy policy and terms** | Build task + legal review | Publishing. Must state the right-to-erasure mechanism plainly: personal fields are tombstoned, the ledger entry and its hash remain, the chain stays verifiable and the person disappears from it. |
| **L6** | **Processor agreements / DPAs** with every vendor in E.1 | Administrative act | POPIA s72 compliance. Includes a **POPIA operator agreement with the payment provider** — a new outbound personal-data flow, however narrow the allowlist. |
| **L7** | **The legal opinion (A4) and the three Paystack answers (A1–A3)** | Administrative act | All of Part B |
| **L8** | **The vendor's Restricted Business List, read rather than assumed** | Administrative act | M5-04. Not fetched for the analysis. |
| **L9** | **Trademark on "Isipheko"** | Administrative act | Nothing technical |
| **L10** | **The subaccount-review operational commitment** | Administrative act | M5-05 ships an SLA with nowhere to live. Somebody clears a queue, on weekends, or a funeral on Sunday does not get paid. |
| **L11** | **User interviews on the public-ledger default and the needs board** | Research | Nothing, and it should. M2-04, M2-06 and M2-10 are the three tasks most exposed to being wrong about how people behave, and all three are built. Part J item 6's advice — build behind a flag — was not taken, because the interviews were not done and nobody noticed the branch. |

---

## Part F — The copy that is untrue, unverified, or unread

Three categories, and they need three different kinds of person.

### F.1 Known untrue, and named as such

| Where | String | State |
|---|---|---|
| `src/copy/dashboard.ts` `money.available` / `availableNote` | *"Settled"* / *"past the window in which a payment can be reversed"* | **The last of three.** M5-08. Two facts under one label on hosted events. |
| `src/copy/dashboard.ts` `payout.intro`, `conditions.bank.notYet`, `conditions.witness.notYet` | *"Nothing is paid out through Isipheko yet"*, *"Nothing to ask for yet"* | **True today and untrue the day M5-09 lands.** Not a fix; a dependency. |
| `src/copy/dashboard.ts` `conditions.bank.remedy` / `.protects` | Part F's Stitch BAV wording — *"we check it against your verified name with your bank"* | **Describes a vendor that is gone.** Resolve Account returns a name we compare ourselves; it is a string comparison we perform, not a check a bank performed. Rewritten in M5-05. `docs/implementation-plan.md` Part F needs rewriting entirely, not editing. |
| `src/copy/event.ts:197` `moneyBody` | *"Nothing on this page can take money from you yet. When contributing opens, you will be told exactly where your money goes before you send it."* | **Untrue today, not at some future task.** M5-02 built the hosted pay step; `src/ui/public-page.tsx` renders this unconditionally and reads no `mode`. On the trust panel, on the page a contributor reads immediately before paying. **M5-02b, ready, and the most urgent item in this document.** |
| `src/copy/contribute.ts` `pay.foot`, `pay.intro`, `pay.submit`, `done.body`, `done.pending`, `payDetailsCopy.intro` | *"Nothing is taken from you here. You send it yourself, from your own app."* and the rest | Mode-keyed at M5-02 where the flow needed it; the remainder is M5-06's. `payDetailsCopy.intro` also contains **"Mode A" — system vocabulary that reached the interface** and should not have. |
| `design/dashboard.html` | The R1 test deposit, the countdown on the bereavement variant, the held-balance payout section with a Request button | **Three known-untrue elements in a file CLAUDE.md calls a source of truth.** Documented in `docs/decisions.md` M3-08 §2. Treat that file as something to check against the rules, never to copy from. |
| `design/collection.html` | The shortfall arithmetic | Not implementable without M2-10b. |
| `design/event.html` | Bands its funeral variant's beads by amount | A prototype bug of the same class as the accent literal M1-04 found; corrected in M2-06. |
| `design/setup.html`, `design/collection.html` | The gathering archetype's kicker is `Umhlangano` | **`src/` ships `Itiye`.** A straight disagreement between the prototype and the code on a user-facing ceremony name, unrecorded anywhere. F.3 has to resolve it, not choose it. |
| `src/copy/share.ts:69` | *"Every person who opens it sees your verified name"* is documented as not shipped | **It ships**, from `src/copy/setup.ts:246`. True since M3-02; the doc comment is stale and `introVerified` beside it is an unused duplicate. M1-10. |
| `src/copy/contribute.ts:217` `payDetailsCopy.intro` | *"Mode A: people pay you directly…"* | **System vocabulary that reached the interface.** An organiser does not know what Mode A is and should never have to. |

**The pattern is worth naming.** Every one of these was found by a person reading carefully, one at a time, after the code shipped. **Four money strings have now been wrong in four separate passes**, and the fourth — M5-02b — had been named in writing as *"the most dangerous string in the change"* before the change that made it untrue was merged. Careful reading is not the control. **M5-13 is the only structural answer** and it is ready now.

### F.2 Unverified — built, never observed

| Claim | Who can close it |
|---|---|
| The WhatsApp link preview renders correctly on iOS and Android | A person with a public URL and two phones — M2-07b |
| The album passes a commercial preflight | A print shop — M4-03b |
| Our incoming ITN parameter string matches what PayFast signed | A person with a tunnel and a sandbox payment — M5-01b |
| Every claim in Part B | The sandbox, once there are keys |

### F.3 Unread — the isiZulu strings, and one correction about Sesotho

Part J item 9 says *"isiZulu and Sesotho copy in the designs needs first-language review before anything ships publicly."* Nothing has happened, and **no first-language speaker has read any of it.**

**One correction, because it changes the size of the job: no Sesotho ships.** The only Sesotho in the repository is a single sample condolence message in a prototype — `"Robala ka kgotso."` at `design/event.html:259` — beside isiZulu ones in the same fake strand. It has never been in `src/`. What ships is isiZulu, plus South African English. Item 9 should be corrected to say so; leaving it as written makes the review sound like two languages when it is one, and quietly reserves a decision — whether to serve Sesotho speakers at all — that nobody has actually taken.

**What ships, measured:**

- **13 distinct isiZulu terms**: `umcimbi`, `umkhaphi`, `abakhaphi`, `incwadi`, `ukupheka`, `Sanibonani`, and the seven ceremony names `Umshado`, `Umembeso`, `Umngcwabo`, `Umbuyiso`, `Imbeleko`, `Umgidi`, `Itiye`.
- **59 user-facing string literals** contain at least one of them, across **14 files** — nine in `src/copy/`, one in `src/domain/archetype/`, one UI component, and two route files (the last three are M1-10's).
- Plus roughly **22 isiZulu proper nouns and placenames** shipped as sample and placeholder copy — *uMaZondi*, *Nomsa Mthembu*, *KwaMashu, KwaZulu-Natal*, *Thandi Ngcobo* and the rest. These sit in field placeholders and consequence previews, which means they are the first isiZulu a new organiser reads and nobody has checked that a clan name is being used the way a clan name is used.

**Three specific things a reviewer must resolve rather than merely approve:**

1. **`Umgidi` is the kicker for the `graduation` archetype.** It is not obviously the word for a graduation and nothing in `docs/` records why it was chosen.
2. **The gathering archetype is `Itiye` in `src/` and `Umhlangano` in two prototypes.** One of them is wrong and the disagreement is unrecorded.
3. **The prototypes' isiZulu was dropped on the way into the code.** `design/contribute.html` closes with `Ngiyabonga.` and `Halala, and thank you.`; `src/copy/contribute.ts:153` ships `Thank you`. The bereavement message placeholder `e.g. Lala ngoxolo MaZondi.` did not survive either. That may have been right — an English fallback is honest where the rest of the flow is English — but it was not a recorded decision, and it means the most emotional moment in the product lost the language it was written in without anybody deciding that it should.

**Then the scope question nobody has answered:**

- **If the answer is "check what ships"**, it is a review pass over the isiZulu terms already in `src/` and `design/` — kickers, ceremony names, and the glossary. Days.
- **If the answer is "ship in isiZulu"**, it is a translation of the entire copy layer, which is what `src/copy/` was built keyed for (Part D), plus a `locale` on organisers and events that was deliberately **not** stubbed — *"an unused column is an invitation to populate it badly"* (M2-07). Weeks, and the emotional moments in this product do not happen in a second language, so it is not a small thing to defer either.

**Nobody has decided which.** Until somebody does, this is a question and not an estimate. Part H.

What can be said without deciding: **the review must precede launch, not follow it.** A misused ceremony term on a funeral page is not a typo. It is the product being wrong about the thing it claims to understand, in front of the family, permanently, on a page they shared with fifty people.

---

## Part G — The ordering I would actually take

Six phases. Phases 1 and 2 run in parallel — the first is administrative and has lead times measured in weeks, the second is code that needs nobody's answer.

**Phase 1 — Start the clocks (week one, no code).**
A1–A4 to Paystack and to an attorney, together, in writing. L1 (CIPC) and L2 (the domain) the same week, because L1 gates the merchant account and L2 gates four separate verification items that are otherwise idle. Quotes from all three identity vendors (E2), because the choice decides whether a build task exists. The E6 latency test.

**Phase 2 — The ready code, while Phase 1 waits.** In this order, and the first two are not negotiable positions:

1. **M5-02b**, the trust panel. A shipped page tells a stranger it cannot take money, on the screen before the one that takes it. Nothing else in this document is both untrue in production and read by somebody deciding whether to trust us.
2. **M5-08**, the last untrue money label, and then **M5-13, the scan** — in that order, so the scan is written against a codebase where all four instances are fixed and it can be left failing-red for the fifth.
3. **OPS-09**, object storage. It is the one factory that does not refuse in production, and the thing it silently drops is a photograph somebody attached to a funeral.
4. **OPS-01, CI.** Rule 9 says it exists. Everything after this is safer with it, and the size gate stops being a thing somebody remembers.
5. **M1-09, the home page**, with its 404. It is the only screen a stranger reaches and everything else assumes somebody arrived.
6. **M3-07b**, the review queue's invisible SLA failure — a promise breaking silently on the screen built to keep it.
7. **M5-12**, the collections tripwire, widened *before* the temptation exists, which is the whole argument for its position here.
8. **M1-10**, the copy-layer leaks — ahead of Phase 5's language review, because a translator cannot translate strings that are not in the translation unit.
9. **M4-01b**, then **M4-02b** once its design choice is made.

**Phase 3 — Wire the vendors as credentials land.** E1 (SMS) first, because nothing organiser-side works without it. Then E2 (identity), which is what makes anything publishable — and if the vendor needs capture, the selfie task is written here and earns M3-01's criterion again rather than inheriting it. Then E3 (storage), E5 (email), E4 (WhatsApp BSP, which has the longest administrative lead time and should have been started in Phase 1).

**Phase 4 — Somewhere to run.** OPS-02 once E6 is decided, then OPS-03 (the four runners, including nightly ledger verification), OPS-04 (KMS), OPS-06, OPS-07, OPS-08. OPS-05 before launch rather than when there is a second admin, because an empty `ADMIN_PHONE_NUMBERS` makes M3-06's promise unkeepable with nothing anywhere saying so.

**Phase 5 — Launch admin.** L3, L4, L5, L6. F.3's first-language review, once somebody has decided whether it is a check or a translation — and it must land **before** anything is shared publicly, not in the same week. L11's interviews, which should have happened before M2-04 and M2-06 shipped and are now a validation rather than a design input.

**Phase 6 — Milestone 5, once Part A is answered.** M5-04 → M5-05 → M5-06 → M5-08's second fact → M5-07 → M5-09 → M5-10 → M5-11 → M5-14. M5-15 only if the vendor answers `post`. M5-01b whenever, and last, unless PayFast turns out to be the vendor.

**Note what is not in Phase 6:** Milestone 5 is not on the path to a real person using this product. Mode A is complete and needs no provider. If Part A comes back badly, the launch does not move.

### The single item that unblocks the most

**A2 — the aggregation-clause answer from Paystack, in writing.**

It gates M5-04 through M5-15 — every remaining task in the milestone. Nothing else in this document gates more than three. It costs one email. And unlike A1, which changes the *shape* of the work, A2 decides whether there is any work: the identically-shaped clause in PayFast's terms is the reason `PayFastProvider` is checkout-only and cannot typecheck into `HeldBalanceProvider`. If Paystack's answer is the same, the entire hosted model needs a different vendor and every dependent task is written against the wrong one.

It is also the question most likely to be skipped, because the vendor sells a subaccount product built for marketplaces and the clause sits in the card section rather than as a general prohibition — which reads like permission until somebody asks. Ask before, not after. After looks like a terminated account with an unsettled balance in it.

**The second-most, and the one to run beside it: E1, the SMS credential.** It unblocks no task in this document and it blocks every organiser action in production, because phone OTP is the only authentication that exists. It is the shortest distance between what is built and a real person using it.

**Neither is the most *urgent*, and the distinction matters.** A2 and E1 unblock the most; **M5-02b is the thing to fix first**, because it is the only item here that is wrong in shipped code, on a public page, in the panel a stranger reads to decide whether the page is a scam. It blocks nothing. It should still be Monday morning.

---

## Part H — What I could not scope, and why

Seven things. Each is a question, not an estimate, and writing a task around any of them would be writing a guess.

1. **M5-04's interface, M5-09 and M5-10 in their entirety.** All three depend on A1. If a manual settlement cannot be released by us, the adapter implements the narrow interface, `payouts` is deleted rather than reshaped, the 72-hour hold and the witness approval are withdrawn from the copy, and M5-09 and M5-10 do not exist. That is a different plan and I will not pre-write either version.

2. **Whether the tip can carry the cost.** A no-tip contribution loses us 2–2.9% plus a rand, because `bearer: "account"` is what lets the ledger say what the family received. This is the number that decides whether the model works, and the pressure it creates — toward a default, a pre-selection, a percentage — is the pressure the analysis is on record as refusing. **Decide it with real numbers before M5-07's copy is written, not after.** If the economics do not work with a genuinely voluntary tip, the answer is a different revenue model, not a less voluntary tip.

3. **Whether the identity vendor requires a selfie capture step.** E2. If it does, there is a build task here — capture, upload, and an image pipeline we are then responsible for not persisting — and M3-01's *"no image reaches storage or logs"* has to be proved again rather than inherited, because today it is true only because nothing is captured. I cannot size a task whose existence is undecided.

4. **The isiZulu and Sesotho work.** F.3. Days if it is a review of what ships; weeks if it is a translation of the copy layer plus a locale column that was deliberately not stubbed. Nobody has chosen, and the two answers are different projects.

5. **Whether need items carry a real cost.** M2-10b. A second field on the screen where an organiser is already answering the most questions in the product, for a line that appears on one page. It is a trade, and it is not mine to make.

6. **How a hosted event behaves when its beneficiary stops working.** M5-06 assumes the switch is one-way. An event that goes hosted and then loses its beneficiary — a closed account, a failed review, a deactivated subaccount that strands the family's money (§1.5) — has contributors mid-flow and nobody has designed that state. It is a real product question and it is not answered anywhere in `docs/`.

7. **What `payouts` should look like.** The analysis says reshape it from Stitch's disbursement states into a settlement release request. Both the current shape and the proposed one describe mechanics nobody has confirmed, and the table is empty, so the migration is cheap whenever the answer arrives. **Do not migrate it early to look ready.**

---

*Written against the repository at `fce894e`, 29 August 2026. Vendor terms, APIs and pricing change; every claim about Paystack in Part A and Part B is inherited from `docs/paystack-analysis.md` and carries its verification date, not this one.*
