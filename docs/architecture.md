# Isipheko — Phase 2: System Architecture

**Status:** Design for review. Verified against live vendor documentation, July 2026.
**Companions:** Phase 1 Research, Phase 1.5 Solutions
**Purpose:** The technical design that Phase 3 (implementation spec) and Claude Code will build from.

Every external dependency in this document has been checked against primary vendor documentation. Where something remains unverified, it is marked **[UNVERIFIED]** inline rather than assumed.

---

## 0. What Changed Since Phase 1.5 — Two Findings That Alter the Design

### 0.1 The individual-payout blocker is resolved

Phase 1 flagged this as the risk most likely to break the plan. It is now answered.

**Stitch's Bank Account Verification API explicitly supports verifying accounts against a 13-digit South African ID number for individuals.** The `accountHolder.individual.identifyingDocument.identityDocument` input takes an SA ID, and the response returns a per-field breakdown: `accountExists`, `identityDocumentMatch`, `initialMatch`, `lastNameMatch`, plus `accountOpen`, `accountOpenForMoreThanThreeMonths`, `accountAcceptsCredits` and `accountAcceptsDebits`.

**Stitch's Disbursements API pays out to any domestic bank account** with a beneficiary specified by name, `bankId`, `accountNumber` and `accountType` — no sub-merchant registration required.

This is materially better than the sub-merchant/split model we assumed we'd need. We verify the organiser's account belongs to them by ID, then disburse to it. Both are documented, both have sandbox simulation, both have Postman collections.

### 0.2 But disbursements require a float account — and that reopens the regulatory question

Stitch's documentation states plainly: *"Disbursements are currently only available to South African customers. A float account is required."* Disbursements draw down against a balance we fund; insufficient balance leaves the instruction on hold for 7 days, then errors with `insufficient_funds`.

**This means money does route through our commercial relationship.** Pay-ins settle to us; we fund a float; disbursements draw from it. That is closer to the TPPP activity described in Directive 1 of 2007 than a pure split-payment model would be.

**This does not kill Mode B, but it changes the legal question we must ask.** The question is no longer *"can we avoid touching funds?"* but *"does operating a Stitch float account and instructing disbursements constitute accepting money for on-payment to a third person, and if so, does Stitch's own licensing cover us as their client, or do we need our own registration?"*

Stitch's docs direct float-account enquiries to `support@stitch.money`. **That conversation and the legal opinion must happen together, and both must precede any Mode B build.** [UNVERIFIED — this is the single most important open item in this document.]

**Architectural consequence:** the payment layer must be a swappable adapter behind a stable internal interface. If the answer forces us to a sponsored-BSP arrangement or a different provider, we replace one adapter, not the application.

---

## 1. Architecture Principles

These constrain every decision below.

1. **The money layer is an adapter, never a dependency.** Domain code speaks to a `PaymentProvider` interface. Stitch, a sponsored BSP, or manual reconciliation are implementations.
2. **The ledger is the source of truth, and it is append-only.** Nothing is ever updated or deleted — corrections are new entries. This is the trust product; it must be provably tamper-evident.
3. **Contributors never authenticate.** Every design that requires a contributor account is wrong. The contribution path must work for someone who has never heard of us, on a borrowed phone, with 40MB of data left.
4. **Data residency is South Africa.** Chosen once, enforced structurally, not by policy document.
5. **Mode A and Mode B share one domain model.** A contribution is a contribution whether confirmed manually or by webhook. Only the `verification_source` differs.
6. **Every rand is idempotent.** Payment operations carry a nonce. Retries must never double-pay or double-credit.
7. **Bereavement constraints are enforced in code, not guidelines.** It must be structurally impossible to render a progress bar on a funeral page.

---

## 2. System Context

```
                        ┌─────────────────────────────┐
   Contributor          │                             │
   (no account) ───────▶│                             │
                        │      ISIPHEKO PLATFORM      │
   Organiser            │                             │
   (verified) ─────────▶│   Web (PWA) + API + Jobs    │
                        │                             │
   Witness              │                             │
   (light auth) ───────▶│                             │
                        └──────────┬──────────────────┘
                                   │
        ┌──────────────┬───────────┼───────────┬──────────────┐
        ▼              ▼           ▼           ▼              ▼
   ┌─────────┐   ┌──────────┐ ┌────────┐ ┌─────────┐   ┌───────────┐
   │ Stitch  │   │ Identity │ │WhatsApp│ │ Object  │   │  Print    │
   │ Pay-ins │   │ Verify   │ │  BSP   │ │ Storage │   │ Fulfilment│
   │ Payouts │   │ (DHA)    │ │        │ │         │   │           │
   │ BAV     │   │          │ │        │ │         │   │           │
   └─────────┘   └──────────┘ └────────┘ └─────────┘   └───────────┘
    Mode B only   Both modes   Both       Both          Phase C
```

**Trust boundaries:** contributor input is fully untrusted; organiser input is authenticated but untrusted; PSP webhooks are signature-verified; identity provider responses are trusted but logged immutably.

---

## 3. Technology Stack

Chosen for a small team, agentic implementation, and the performance budget in §9.

| Layer | Choice | Rationale |
|---|---|---|
| **Framework** | Next.js (App Router), TypeScript strict | Server components keep the contributor page tiny — critical given SA data costs. One codebase for PWA and API. Excellent Claude Code ergonomics. |
| **Runtime** | Node.js LTS | Stitch has no official SDK; GraphQL/REST over `fetch` is fine. |
| **Database** | PostgreSQL 16 | Append-only ledger needs real constraints, transactions and row-level security. Non-negotiable over document stores. |
| **ORM** | Prisma | Migration discipline and type generation; strong Claude Code support. |
| **Cache / queue** | Redis + BullMQ | Job queue for webhooks, notifications, album generation, reconciliation. |
| **Object storage** | S3-compatible, af-south-1 | Photos, generated OG images, album PDFs. |
| **Hosting** | AWS `af-south-1` (Cape Town) **or** Azure South Africa North (Johannesburg) | Both provide in-country residency for POPIA s72. Azure Johannesburg has Availability Zones and ZAR billing via partners; AWS Cape Town is the more common developer default. **Decide on latency test + ZAR billing preference.** |
| **CDN / WAF** | Cloudflare | Bot protection and rate limiting at the edge — essential given the fraud profile. Edge caching for public event pages. |
| **Auth (organiser)** | Auth.js, OTP-first | Phone-number OTP primary; email secondary. Passwords are friction and a liability. |
| **Email** | Transactional provider with EU/ZA processing | Receipts and fallbacks only. |
| **WhatsApp** | Meta Cloud API via a BSP | See §8. |
| **Observability** | OpenTelemetry → self-hosted or ZA-region APM | Avoid shipping PII to a US-region SaaS by default. |
| **Error tracking** | Sentry, self-hosted or EU region, PII scrubbing on | POPIA s72 applies to stack traces containing personal data. |

**Explicitly rejected:** serverless-only architectures (float reconciliation and webhook ordering need stateful workers), NoSQL primary store (the ledger needs ACID), and any US-region managed service holding personal data without a s72 justification.

---

## 4. Domain Model

### 4.1 Core entities

```
Organiser ──1:N──▶ Event ──1:N──▶ Contribution ──1:1──▶ LedgerEntry
                     │
                     ├──1:N──▶ NeedItem ──1:N──▶ NeedClaim
                     ├──1:N──▶ Witness
                     ├──1:N──▶ Payout ──1:1──▶ LedgerEntry
                     └──1:1──▶ Album
```

### 4.2 Schema (abbreviated — full DDL in Phase 3)

**`organisers`**
`id`, `phone_e164` (unique), `email`, `display_name`, `id_number_hash` (SHA-256 + pepper, never plaintext), `id_verification_status` (enum: `unverified` | `pending` | `verified` | `failed`), `id_verified_at`, `bank_account_id` (FK, nullable), `created_at`

**`bank_accounts`**
`id`, `organiser_id`, `bank_id` (Stitch enum), `account_number_encrypted`, `account_type`, `bav_result` (jsonb — full BAV response stored immutably), `bav_verified_at`, `status`

**`events`**
`id`, `organiser_id`, `slug` (unguessable, ≥16 chars base62), `archetype` (enum — see §6), `title`, `description`, `event_date`, `target_amount_cents` (nullable — **must be NULL for bereavement archetypes**, enforced by CHECK constraint), `visibility_default` (enum), `mode` (enum: `ledger_only` | `hosted`), `direct_pay_details` (jsonb, Mode A only), `status`, `created_at`, `closed_at`

**`contributions`**
`id`, `event_id`, `contributor_name`, `contributor_phone_e164` (nullable), `type` (enum: `cash` | `in_kind` | `cash_toward_item`), `amount_cents` (nullable for pure in-kind), `need_item_id` (nullable), `message`, `photo_key` (nullable), `visibility` (enum: `public` | `name_only` | `anonymous`), `verification_source` (enum: `organiser_confirmed` | `psp_webhook`), `psp_payment_id` (nullable), `status` (enum: `claimed` | `pending` | `confirmed` | `disputed` | `void`), `created_at`, `confirmed_at`

**`need_items`**
`id`, `event_id`, `label`, `category`, `quantity_required`, `quantity_claimed`, `unit`, `estimated_cost_cents` (nullable), `allows_cash_toward` (bool), `sort_order`

**`need_claims`**
`id`, `need_item_id`, `contribution_id`, `quantity`, `claimant_name`, `claimant_phone_e164`, `status` (enum: `claimed` | `delivered` | `expired` | `withdrawn`), `expires_at`, `delivered_confirmed_at`

**`witnesses`**
`id`, `event_id`, `name`, `phone_e164`, `status` (enum: `invited` | `accepted` | `declined`), `can_approve_payouts` (bool), `accepted_at`

**`ledger_entries`** — append-only, the trust artefact
`id`, `event_id`, `sequence_no` (monotonic per event), `entry_type` (enum: `contribution` | `payout` | `adjustment` | `reversal`), `direction` (enum: `credit` | `debit`), `amount_cents` (nullable), `in_kind_description` (nullable), `reference_id` (polymorphic FK), `prev_hash`, `entry_hash`, `created_at`

**`payouts`**
`id`, `event_id`, `amount_cents`, `bank_account_id`, `psp_disbursement_id`, `nonce` (unique), `status` (mirrors Stitch disbursement states), `requested_by`, `approvals` (jsonb array), `hold_expires_at`, `requested_at`, `completed_at`

**`audit_log`** — append-only, everything security-relevant
`id`, `actor_type`, `actor_id`, `action`, `target_type`, `target_id`, `ip_hash`, `user_agent_hash`, `metadata` (jsonb), `created_at`

### 4.3 The ledger hash chain

Each `ledger_entries` row stores `prev_hash` (the previous entry's `entry_hash` for that chain) and

```
entry_hash = SHA256(
  sequence_no || entry_type || direction || amount_cents ||
  in_kind_description || reference_id || contribution_id ||
  prev_hash || created_at
)
```

**`in_kind_description` and `contribution_id` were added in M2-01** and are not in the original formula. Without the description in the chain, *"the tent"* could be edited to *"a chair"* and every hash would still verify — and the threat model here is precisely somebody with database write access, since the application role holds no UPDATE on `ledger_entries` at all. In-kind is the core of what *isipheko* means: the description **is** the contribution. See docs/decisions.md M2-01.

Fields are joined with U+001F (unit separator) and a NULL is written as U+0000 — both are characters Postgres refuses to store in a text column, so no value can forge a field boundary and an absent description is distinguishable from an empty one. `created_at` is ISO-8601 with milliseconds, supplied by the application because the hash covers it, and matching what `TIMESTAMP(3)` stores.

**This format cannot be changed.** Not "requires a migration" — changing it invalidates every chain ever written, and leaves no way to tell an altered row from a re-serialised one. A fixed test vector pins it.

The first entry in a chain uses `prev_hash = SHA256(chain_id)` — the event id, or the collection id for a standalone collection chain. There is **no synthetic genesis row**: the first real contribution or payout is sequence 1. Sequence numbers are per chain.

This makes tampering detectable: altering any historic entry breaks every subsequent hash. A nightly job re-verifies every chain and alerts on mismatch. This is cheap to implement and is a genuinely defensible claim to make to users — *"nobody, including us, can quietly change this record."*

**Database enforcement:** `REVOKE UPDATE, DELETE ON ledger_entries` from the application role. Corrections happen via `reversal` entries only.

### 4.4 Money representation

All amounts are **integer cents in ZAR**, stored as `BIGINT`. No floats, ever. A shared `Money` type wraps arithmetic. Stitch's `MoneyInput` takes `{quantity, currency}` — conversion happens only at the adapter boundary.

---

## 5. Payment Architecture

### 5.1 The adapter interface

**Superseded by what M5-01 built.** The shape below was designed around Stitch and is kept for the record; `src/domain/payments/provider.ts` is the contract, and docs/decisions.md M5-01 says why it differs.

```typescript
// The design, July 2026 — three of these did not survive.
interface PaymentProvider {
  verifyBankAccount(input: BankAccountVerificationRequest)
    : Promise<BankAccountVerificationResult>;
  createPayIn(input: PayInRequest): Promise<PayInHandle>;
  createDisbursement(input: DisbursementRequest): Promise<DisbursementHandle>;
  getDisbursementStatus(id: string): Promise<DisbursementStatus>;
  verifyWebhookSignature(raw: string, sig: string): boolean;
}
```

**As built, it is two interfaces rather than one:**

```typescript
interface PaymentProvider {
  startPayIn(request: PayInRequest): Promise<PayInHandle>;
  verifyWebhook(delivery: WebhookDelivery): Promise<WebhookVerification>;
}

interface HeldBalanceProvider extends PaymentProvider {
  balanceFor(beneficiary: BeneficiaryReference): Promise<HeldBalance | null>;
  requestWithdrawal(request: WithdrawalRequest): Promise<WithdrawalHandle>;
  withdrawalState(reference: ProviderReference): Promise<WithdrawalState>;
}
```

Three changes, each with a reason:

**`createDisbursement` and `getDisbursementStatus` are gone.** They describe instructing a credit transfer out of a float account we fund, which is the arrangement §0.2 flagged and the reason Milestone 5 was gated. What replaces them acts against a balance the provider holds and we never fund.

**`verifyBankAccount` is gone.** Onboarding a beneficiary carries its own consent, evidence and review, and is not something a payment interface should be able to do in passing. A `BeneficiaryReference` arrives already opaque.

**The split into two is contractual.** PayFast's General Terms 5.17(v) and (vi) forbid aggregating a transaction for multiple suppliers and submitting one on behalf of a third party — so a checkout-only provider implements the narrow interface and **cannot typecheck into the wide one**. That is what makes the constraint a compile error rather than a paragraph.

Implementations: `SimulatedPaymentProvider` (development and test; holds a balance, settles on request, and POSTs its notifications over HTTP so the receiver and the signature check are exercised rather than stepped around), `PayFastProvider` (checkout only, one merchant account). `paymentProvider()` throws in production until a real one is chosen. **No domain, UI or database code names a provider** — a source scan asserts it (CLAUDE.md rule 10).

### 5.2 Mode A — Ledger-Only flow

```
Contributor opens event page
  → sees organiser's ShapID / bank details + unique reference code
  → pays from their own banking app (PayShap: <10s, 24/7)
  → returns, taps "I've paid", enters name + amount + optional message/photo
  → contribution created with status='pending', verification_source='organiser_confirmed'
  → organiser notified (WhatsApp utility template)
  → organiser confirms receipt against their own bank notification
  → status='confirmed', ledger entry appended, contributor notified
```

**Reference code design:** 6 characters, base32 Crockford (no ambiguous chars), derived per contribution, prefixed with a 3-letter event tag. Example: `MTH-4K7B2X`. Short enough to type into a banking app's reference field, unique enough to reconcile.

**Anti-abuse:** unconfirmed contributions expire after 14 days. Rate-limit self-reports per IP and per phone. Contributions marked `disputed` by the organiser stay visible in the ledger with that status — never silently deleted.

### 5.3 Mode B — Hosted flow

```
Contributor selects method (PayShap / Capitec Pay / card / wallet)
  → Stitch pay-in initiated, contribution status='pending'
  → Stitch webhook (signature-verified) → status='confirmed'
  → ledger entry appended atomically in same transaction
  → contributor + organiser notified
```

Payout:

```
Organiser requests payout
  → guard: id_verification_status='verified'
  → guard: bank_account.bav_result.accountVerificationResult='verified'
  → guard: bav_result.accountAcceptsCredits='verified'
  → guard: 72h hold elapsed on contributions being drawn
  → guard: witness approval if amount > threshold
  → createDisbursement(nonce=uuid, type='INSTANT'|'DEFAULT')
  → webhook state machine → ledger debit entry on DisbursementCompleted
```

### 5.4 Disbursement state machine

Stitch's documented states, mapped directly:

```
Pending → Submitted → Completed
              ↓           ↓
            Error     Reversed  (non-terminal Completed!)
              
Paused (insufficient_funds) → Completed | Cancelled | Error
```

**Two properties that must be handled explicitly:**

1. **`DisbursementCompleted` is not final.** Stitch documents that a completed disbursement can later be `Reversed` — for instance where the destination account was recently closed. The ledger must support a `reversal` entry type, and the UI must not tell the organiser the money has definitely arrived until a reasonable settlement window has passed.
2. **Paused disbursements block the FIFO queue.** Stitch processes first-in-first-out, and a disbursement exceeding available float pauses *more recent* ones. Float monitoring with alerting is an operational requirement, not a nice-to-have.

**Error reasons to handle by name:** `bank_error`, `bank_processing_error`, `insufficient_funds`, `restricted_account`, `inactive_account`, `exceeded_limit`, `invalid_account`, `beneficiary_bank_processing_error`, `invalid_transaction_details`.

Each maps to distinct user-facing copy. `restricted_account` and `inactive_account` are the organiser's problem to fix; `bank_error` is ours to retry.

### 5.5 Idempotency

- Every disbursement carries a `nonce`, stored before the API call. Stitch rejects duplicate nonces — retry with the **same** nonce is safe and is the documented recommendation.
- Webhooks are deduplicated on `psp_payment_id` + status.
- Retries use exponential backoff.
- Check-digit verification failures (`account_verification_failed_cdv`) return `BAD_USER_INPUT` and create no disbursement — handle as a validation error, not a payment failure.

### 5.6 BAV integration notes

- `verifyBankAccountDetails` may return `RESULT_PENDING` and take up to 120 seconds. **This must be an async job with UI polling, not a blocking request.**
- Results are cached by Stitch for 48 hours and not re-billed within that window — our retry logic should exploit this rather than fight it.
- Store the **full** BAV response as immutable JSONB. It is our evidence that we verified before paying.
- Sandbox: family name `Clegg`, initials `J`, ID `5306075800082`, account number ending in `0` produces a verified result.

---

## 6. Event Archetypes — Enforced in Code

```typescript
type ArchetypeGroup = 'union' | 'bereavement' | 'remembrance'
                    | 'arrival' | 'achievement' | 'gathering';

interface ArchetypeConfig {
  group: ArchetypeGroup;
  allowsTarget: boolean;
  allowsProgressBar: boolean;
  allowsCountdown: boolean;
  allowsCelebratoryMotion: boolean;
  defaultAmountVisibility: 'public' | 'hidden';
  needsTemplate: NeedTemplateId;
  palette: PaletteId;
  copySet: CopySetId;
}
```

**Bereavement group is hard-locked:** `allowsTarget: false`, `allowsProgressBar: false`, `allowsCountdown: false`, `allowsCelebratoryMotion: false`, `defaultAmountVisibility: 'hidden'`.

Enforced at three layers:
1. **Database** — `CHECK (archetype_group != 'bereavement' OR target_amount_cents IS NULL)`
2. **Type system** — components requiring a target won't compile against a bereavement config
3. **Runtime** — a render guard throws in development if violated

This is deliberately over-engineered. Getting it wrong once, on a real funeral, is a failure we cannot apologise our way out of.

**Need templates** ship per archetype: a funeral template pre-populates tent, chairs, catering volume, transport, grocery staples. Templates are seed data, versioned, and editable by the organiser.

---

## 7. Identity Verification

### 7.1 Provider options (verified pricing, July 2026)

| Provider | Service | Price |
|---|---|---|
| **VerifyNow** | Real-time HANIS/DHA ID check | R29.90 (Starter) / R26.90 (Business, 10k+ credits) |
| **Didit** | DHA national ID (`zaf_africa_national_id`) | ~$2.95 per successful query |
| **Didit** | Full KYC bundle (ID + passive liveness + face match + IP analysis) | ~$0.33, 500 free/month |
| **Didit** | Passive liveness / active liveness / face match 1:1 | ~$0.10 / $0.15 / $0.05 |
| **Datanamix** | Realtime ID Verification + Photo (returns DHA ID photo) | [UNVERIFIED — pricing not published] |
| **Stitch BAV** | Bank account ↔ SA ID match | [UNVERIFIED — pricing not published] |

### 7.2 Recommended tiering

The economics matter: at R29.90 per DHA check, verifying every organiser at signup on a free product is a meaningful cost. So verification is **staged against risk**:

| Stage | Trigger | Checks | Approx. cost |
|---|---|---|---|
| **Tier 0** | Event creation, or starting a collection | Phone OTP only | ~R0.10 |
| **Tier 1** | **Before anything shareable exists** — an event published publicly, or a collection's link being issued | DHA ID check + liveness/face match | ~R30 + ~R3 |
| **Tier 2** | First payout requested (Mode B) | Stitch BAV (bank ↔ ID) | TBC |

Tier 1 before anything shareable exists — not at payout — because the trust badge has to be on the page *before* anyone is asked for money. That is the entire point.

**This section predates collections (Part D2) and the Tier 1 trigger has been generalised to cover them.** A collection has no publication step: the organiser holds the money in her own account, so there is no payout to withhold and the absence of a shareable link is the only leverage that exists (rule 13). Publication and the share gate are therefore the same moment in two different shapes — the first time a stranger can reach the page. A collection organiser also never reaches Tier 2, because a collection has no payout at all (rule 12).

**Note on the DHA photo route:** VerifyNow and Datanamix can return the official ID photograph for biometric comparison against a live selfie. Didit's bundle does liveness plus face match at a much lower unit price. **Get quotes from both before choosing** — the cost difference at volume is large.

### 7.3 POPIA handling of identity data

- **Never store the ID number in plaintext.** Store `SHA256(id_number + pepper)` for uniqueness checks; the pepper lives in a KMS, not the database. **As built in M3-01 the pepper is an environment variable and not a KMS** — the same stopgap M1-02 recorded for the column encryption key, and now on the open-items list as item 13. `hashIdNumber` takes the pepper as an argument, so moving it is one function.
- **Never store the selfie or the DHA photo** beyond the verification transaction. Store only the result and a provider reference.
- **Explicit consent capture** before any DHA check, with a timestamped record — POPIA s11 requires a lawful basis, and consent is the practical one here.
- Verification results are immutable audit records with a defined retention period.

---

## 8. Notifications

### 8.1 Channel strategy and its cost model

WhatsApp is where these users are — roughly 96% of SA internet users. But Meta's pricing changed materially and is changing again:

- Since 1 July 2025, Meta charges **per delivered template message**, not per 24-hour conversation.
- Non-template messages inside an open 24-hour service window are currently free; service conversations became free and uncapped from 1 November 2024.
- **From 1 October 2026, service replies and utility messages sent inside the 24-hour window become chargeable** — this is six weeks after this document's date and must be budgeted for.
- SA marketing template rate is around $0.086 (~R1.50); utility and authentication are much cheaper.
- South Africa is on the **authentication-international** list, where OTP rates are significantly higher.

**Design consequences:**

1. **Use utility templates, never marketing templates,** for all transactional notifications. Category assignment is made in Meta Business Manager and determines the rate — a message with any promotional element gets reclassified as marketing.
2. **Do not send OTPs over WhatsApp.** SA's authentication-international rate makes this expensive. Use SMS for OTP.
3. **Budget for October 2026.** Model notification cost at the post-change rates from the start.
4. **Every notification must justify its cost.** A per-contribution WhatsApp to the organiser on a 200-contribution funeral is 200 billable messages. Batch and digest instead.

### 8.2 Notification matrix

| Event | Organiser | Contributor | Witness | Channel |
|---|---|---|---|---|
| Contribution self-reported (Mode A) | Batched digest, max 1/hour | — | — | WhatsApp utility |
| Contribution confirmed | In digest | Immediate | — | WhatsApp utility |
| Need item claimed | In digest | Immediate | — | WhatsApp utility |
| Claim expiring in 48h | — | Immediate | — | WhatsApp utility |
| Payout requires approval | Immediate | — | Immediate | WhatsApp utility |
| Payout completed | Immediate | — | Immediate | WhatsApp utility |
| Payout reversed | Immediate | — | Immediate | WhatsApp + SMS |
| OTP | Immediate | — | — | **SMS only** |

Email is the fallback for every row where a WhatsApp number is absent or delivery fails.

---

## 9. Performance & the Data-Cost Constraint

High data costs are a documented structural barrier in South Africa. Every kilobyte on the contributor path is friction between a family and a contribution.

**Budgets, enforced in CI as build-failing gates:**

| Path | Budget |
|---|---|
| Public event page, first load | **≤ 150 KB** transferred (HTML + critical CSS + JS) |
| Contribution flow, incremental | ≤ 80 KB |
| Largest Contentful Paint, throttled 3G | ≤ 2.5s |
| Time to Interactive, throttled 3G | ≤ 4s |

**How:**
- Server components by default; client JS only for the contribution form and the needs board interactions.
- No client-side data-fetching library on the public path.
- Images: AVIF with WebP fallback, responsive `srcset`, lazy below the fold, hard dimension caps on uploads.
- Fonts: one variable font, subset to Latin + the extended characters needed for isiZulu/isiXhosa orthography, `font-display: swap`, self-hosted.
- Public event pages cached at the CDN edge with short TTL and tag-based invalidation on new contributions.
- No analytics script on the contributor path — server-side event capture only. This is a performance *and* a POPIA win.

### 9.1 The OG image is the front door

The WhatsApp link preview is seen more than the page. Generate per-event OG images server-side (Satori/`@vercel/og` or equivalent), cached in object storage, containing: event title, organiser name, verified badge, archetype-appropriate design. Regenerate on material change only.

---

## 10. Security Architecture

Given a threat model where our product is structurally indistinguishable from a scam:

**Application**
- All contributor input validated with Zod at the boundary; no raw input reaches the ORM.
- Event slugs are cryptographically random, ≥16 base62 chars, never sequential — unguessable by design.
- `X-Robots-Tag: noindex` and `robots.txt` disallow on all event pages. A death in the family must not be findable on Google.
- CSP with strict `script-src`, no `unsafe-inline`. HSTS preload. `frame-ancestors 'none'`.
- Rate limits at Cloudflare edge and application: contribution self-reports per IP and per phone, OTP requests, payout requests.

**Payments**
- Webhook signature verification on every inbound PSP call, per Stitch's documented signing scheme. Reject unsigned or stale.
- Client tokens scoped narrowly — `client_bankaccountverification` and `client_disbursement` are separate scopes and must not be combined in one credential.
- Payout approval requires re-authentication (fresh OTP) regardless of session age.
- Float balance monitored with alerting well above the pause threshold.

**Data**
- Encryption at rest (database, object storage) and in transit throughout.
- Bank account numbers encrypted at the column level with a KMS-held key, separate from the database credential.
- ID numbers hashed with a peppered SHA-256; the pepper never touches the database.
- PII scrubbing in logs and error reports, enforced by a serialiser allowlist rather than a denylist.

**Anti-fraud**
- Velocity checks: an organiser creating many events quickly, or an event receiving contributions from an implausible IP spread, flags for review.
- Every event page carries the permanent "Is this real?" panel with verification status, how to check, and how to report.
- A reachable, monitored report channel with an actual response SLA — 57% of South Africans who report scams hear nothing back, and doing better is both right and differentiating.
- All outbound messages state that we never request OTPs, PINs, or card details.

---

## 11. POPIA Implementation

| Requirement | Implementation |
|---|---|
| Information Officer registered | Pre-launch admin task, Information Regulator online portal |
| PAIA manual | Published, separate from privacy policy |
| Lawful basis | Consent for identity verification; contract performance for the event service |
| Data minimisation | Contributors: name + optional message/photo only. No account, no email required. |
| Cross-border transfer (s72) | ZA-region hosting; every third-party processor reviewed for data location; DPAs in place |
| Special personal information | Bereavement events default to hidden amounts; religion is inferable from funeral context and is treated as special PI |
| Breach notification | Runbook targeting Regulator notification within 72 hours, with documented justification for any delay |
| Data subject rights | Self-service export and deletion; deletion tombstones the ledger entry rather than breaking the hash chain |
| Retention | Events archive after 12 months; personal data purged on a defined schedule; ledger hashes retained |
| Cookie consent | Opt-in for anything beyond strictly necessary; no analytics on the contributor path at all |

**The right-to-erasure vs immutable-ledger tension** is real and must be solved deliberately: on a deletion request, the contributor's personal fields are nulled and replaced with a tombstone marker, while the ledger entry, its amount and its hash remain. The chain stays verifiable; the person disappears from it. This should be stated plainly in the privacy policy.

---

## 12. Environments & Deployment

| Environment | Purpose | Data |
|---|---|---|
| **Local** | Development | Seeded synthetic; Stitch test client |
| **Preview** | Per-PR | Ephemeral; Stitch test client |
| **Staging** | Pre-production | Anonymised; Stitch test client; full webhook loop |
| **Production** | Live | ZA region; Stitch live client |

- Infrastructure as code from day one.
- Migrations forward-only, reviewed, run in CI.
- Blue/green or rolling deploys with automatic rollback on error-rate spike.
- Secrets in a managed KMS/secrets manager, never in environment files committed anywhere.
- **Test-mode simulation is well documented by Stitch** and should be wired into automated tests: disbursement amounts of exactly 400/401/402/404 simulate specific failure states, and account numbers ending in `0` simulate success. Build the failure paths against these from the start.

---

## 13. Observability

**Business metrics:** events created, publish rate, contributions per event, in-kind claim rate, claim-to-delivery conversion, payout success rate, tip take-up.

**Technical:** p50/p95/p99 latency on the public event page, contribution funnel drop-off by step, webhook processing lag, disbursement state distribution, float balance headroom, BAV pending-rate.

**Alerting (paging):** float below threshold, webhook processing lag > 5 min, disbursement error rate spike, ledger hash-chain verification failure, identity provider unavailable.

**Ledger integrity job:** nightly full re-verification of every event's hash chain, with a hard alert on any mismatch.

---

## 14. Build Sequence

**Milestone 1 — Foundation:** schema, migrations, auth (OTP), archetype system with bereavement guards, event creation, public event page hitting the performance budget.

**Milestone 2 — Contribution (Mode A):** needs board with claiming and expiry, cash/in-kind/cash-toward-item, reference code generation, self-report and organiser confirmation, ledger with hash chain, WhatsApp share and OG image generation.

**Milestone 3 — Trust:** identity verification integration, verified badge, witnesses, "Is this real?" panel, audit log, report channel.

**Milestone 4 — Album:** message and photo collection, album view, shareable story, print-ready PDF generation.

**Milestone 5 — Hosted payments (Mode B):** *gated on legal opinion + Stitch float conversation.* Payment adapter, Stitch pay-ins, BAV, disbursements with full state machine, 72h hold, witness approval, voluntary tip.

**Milestone 6 — Commerce:** printed album fulfilment, printed invitations, organisation tier.

Milestones 1–4 have no dependency on the unresolved regulatory question. That is deliberate.

---

## 15. Open Items — Explicitly Not Assumed

| # | Item | Blocks | Owner |
|---|---|---|---|
| 1 | **Legal opinion: does operating a Stitch float + instructing disbursements require our own TPPP/SARB authorisation?** | Milestone 5 | Payments attorney |
| 2 | Stitch float account terms, requirements and minimum balance | Milestone 5 | `support@stitch.money` |
| 3 | Stitch pricing on our actual basket (R50–R500, high volume, low value) | Mode B economics | Stitch sales |
| 4 | Stitch BAV per-check pricing | Verification tiering | Stitch sales |
| 5 | Datanamix vs VerifyNow vs Didit — final identity vendor and price | Milestone 3 | Procurement |
| 6 | AWS af-south-1 vs Azure SA North — latency test and ZAR billing | Milestone 1 | Tech decision |
| 7 | WhatsApp BSP selection and markup | Milestone 2 | Procurement |
| 8 | Post-1-Oct-2026 WhatsApp cost model | Notification budget | Finance |
| 9 | CIPC name, domain, trademark on "Isipheko" | Brand | Admin |
| 10 | User interviews validating public-ledger default and needs board | Milestone 2 scope | Research |
| 11 | Print fulfilment partner and unit economics | Milestone 6 | Procurement |
| 12 | Whether PayShap Request is accessible to us as a platform, and on what terms | Mode B method priority | Stitch / PayInc |
| 13 | **KMS for the ID pepper and the column encryption key** — §7.3 and §10 both assume one, and both are environment variables today | Anything real being stored | Tech decision |

**Item 1 is the gate.** Everything in Milestone 5 waits on it, and it should be commissioned this week.

---

*Verified against Stitch, Meta, VerifyNow and Didit documentation as at July 2026. Vendor APIs and pricing change — re-verify before implementation. No legal, financial or tax advice.*
