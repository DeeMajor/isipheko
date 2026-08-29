# Isipheko — Paystack: mechanics, blast radius, and a task breakdown

**Status:** Analysis for decision. Nothing implemented. Supersedes nothing until accepted.
**Companions:** architecture §0, §5, §7 · implementation-plan Part E, Part F, Part J · decisions M2-05, M2-09, M2-10, M2-11, M3-08
**Verified against:** Paystack developer documentation, Paystack South Africa Merchant Services Agreement, Paystack ZA pricing and support articles, fetched 29 August 2026. Where a page is silent it is marked **[SILENT]**; where a page contradicts another page or its own earlier version it is marked **[CONTRADICTS]**.

---

## 0. Three corrections before anything else

### 0.1 `PaymentProvider` does not exist in this codebase

The brief says *"PaymentProvider exists as an interface with a manual implementation."* It does not. It exists in **architecture §5.1 as a design** and is referenced in three doc comments as a pattern other adapters copied — `src/domain/messaging/sms.ts:2`, `src/domain/identity/verifier.ts:4`, decisions M2-07 §3. There is no `src/domain/payments/`, no `src/adapters/payments/`, no `ManualProvider`, and no file in the repository matching `*payment*`, `*stitch*` or `*paystack*`.

What exists instead is Mode A built directly: the organiser's PayShap number in `events.direct_pay_details`, a self-reported contribution, and an organiser confirming it against her own bank message. There is no adapter seam to swap. **Milestone 5 builds the interface, it does not replace an implementation behind one.** That is more work than the brief assumes, and it is also an opportunity: the interface can be shaped around Paystack's actual verbs rather than around Stitch's.

The good news is that everything the interface needs to sit behind is already correctly separated. `src/domain/payout/` is pure. The ledger append is one function. `verification_source` already has a `psp_webhook` member. `events.mode` already has `hosted`. `contributions.psp_payment_id` already exists and is already unique. M1-02 built the shape; nobody has filled it.

### 0.2 "Removes us from the money flow" is true of custody and false of control

Paystack settles a subaccount's share directly to that subaccount's bank account; it does not pass through our Paystack balance. That is a materially better fact pattern than the Stitch float, and it is the strongest thing about this direction. We never fund a balance, never instruct a credit transfer, and no money is ever allocated to us that belongs to someone else.

But `settlement_schedule: manual` reintroduces the thing the float made bad. Under `auto`, money reaches the organiser on Paystack's timetable and we cannot stop it. Under `manual`, **it reaches her when we say so.** We are then exercising discretionary control over the release of another person's money — which is the fact a payments attorney will fix on, and it is closer in substance to the Directive 1 of 2007 question than `auto` is, even though the money is in the same place either way.

This is not an argument against `manual`. It is an argument that the legal question has changed shape rather than gone away, and that it must be put to the attorney **in that exact form**:

> Does instructing the release of a subaccount settlement — where the funds are held by a PASA-licensed TPPP, allocated to the beneficiary throughout, and never allocated to us — constitute accepting money for on-payment to a third person? Does the answer change if the schedule is `auto` and we have no release trigger at all?

The second half matters because the fallback is real: if `manual` is refused, `auto` still works. What is lost is the 72-hour hold and the witness approval, both of which are only enforceable if we hold the trigger. That is a genuine product cost and it should be priced by the person who understands the regulation, not decided here.

### 0.3 The target model works, with three mechanical corrections

Stated plainly, since the brief asked for plainness:

1. **`settlement_schedule` cannot be set when the subaccount is created**, and as of today it is not documented as a request parameter anywhere. See §1.3. This is the single most important unverified item in this document.
2. **"No leaving for a banking app" is not achievable for the cheapest rails.** Capitec Pay pushes a notification into the Capitec app for authorisation; Ozow EFT redirects to the customer's internet banking. **PayShap is not a Paystack channel at all**, which means the rail Phase 1.5 ranked first for this basket size is reachable only through the Mode A path we have already built. See §1.6.
3. **Card acceptance makes us the merchant of record**, liable for chargebacks and capped at a 1% dispute rate, on transactions whose beneficiary has already been settled. See §1.8.

None of these is fatal. Together they say: **Paystack hosted checkout is an addition to Mode A, not a replacement for it.** The recommendation of this document is that both live side by side, per event, and that `events.mode` finally earns the column M1-02 gave it.

---

## 1. The mechanics, verified

### 1.1 Create Subaccount — the fields

`POST https://api.paystack.co/subaccount`, from the [Subaccount API reference](https://paystack.com/docs/api/subaccount/):

| Parameter | Type | Required | Documented as |
|---|---|---|---|
| `business_name` | String | yes | *"Name of business for subaccount"* |
| `bank_code` | String | yes | *"Bank Code for the bank. You can get the list of Bank Codes by calling the List Banks endpoint."* |
| `account_number` | String | yes | *"Bank Account Number"* |
| `percentage_charge` | Float | yes | *"The percentage the main account receives from each payment made to the subaccount"* |
| `description` | String | optional | — |
| `primary_contact_email` | String | optional | — |
| `primary_contact_name` | String | optional | — |
| `primary_contact_phone` | String | optional | — |
| `metadata` | String | optional | Stringified JSON |

**The brief's field names are half right.** `business_name`, `account_number` and `percentage_charge` are as described. `settlement_bank` is **not** a documented request parameter — the parameter table says `bank_code`. **[CONTRADICTS]** The cURL sample on the same page, and the sample on the [Split Payments guide](https://paystack.com/docs/payments/split-payments/), both send `settlement_bank`, and `settlement_bank` is what comes back in the response (as a bank *name*, not a code). Two of Paystack's own pages disagree with their own parameter table. Send `settlement_bank` if the sandbox accepts it, `bank_code` if it does not, and record which in decisions.

**No identity document is requested, and that part of the brief is exactly right.** There is no field for an ID number, no upload, no KYC object. A beneficiary is created from a name, a bank and an account number. For a product whose beneficiary is an aunt in KwaMashu rather than a registered business, this is the whole reason Paystack is the right direction.

`percentage_charge` is listed without "optional", so it is required, and it is **the main account's cut** — *"if a subaccount was created with `percentage_charge: 20`, 20% goes to the main account and the rest goes to the subaccount"*. We will create every subaccount with `percentage_charge: 0`. See §4.

### 1.2 What the response says that the request cannot

The Create Subaccount response contains two fields that appear nowhere in any request:

```
"is_verified": false,
"settlement_schedule": "AUTO",
```

Both are load-bearing and neither is settable at creation.

### 1.3 `settlement_schedule` — and this is the item to resolve first

The live [Subaccount API reference](https://paystack.com/docs/api/subaccount/) fetched today lists exactly four endpoints — Create, List, Fetch, Update — and `settlement_schedule` appears **only in responses**. It is not a documented body parameter on Create, and it is not a documented body parameter on Update. **[SILENT]**

The [Internet Archive snapshot of the same page from 17 October 2025](http://web.archive.org/web/20251017020134/https://paystack.com/docs/api/subaccount/) documents it on **Update Subaccount only**, never on Create:

> `settlement_schedule` · String · optional · Any of `auto`, `weekly`, `monthly`, `manual`. Auto means payout is T+1 and manual means payout to the subaccount should only be made when requested. Defaults to `auto`

So three things follow, and the third is the problem.

**First**, the brief's *"a subaccount per organiser, created from their bank details, `settlement_schedule: manual`"* is a two-call sequence, not one: create, then update. Between those two calls the subaccount is on `auto`. That window must never contain a transaction. The adapter has to treat subaccount creation as a transaction of its own that is not complete until the schedule reads `manual` on a Fetch.

**Second**, `T+1` is Nigeria's timetable. [Paystack ZA pricing](https://paystack.com/za/pricing) says *"It takes 2 working days after a customer pays for you to receive your payout."* **[CONTRADICTS]** Nothing in our design depends on T+1, but no copy may promise it.

**Third, and this is the one to ask about before anything is built: there is no documented way to request the release.** The Settlements API has two endpoints, List Settlements and List Settlement Transactions. There is no create, no trigger, no release. There is no `settlement.*` webhook event in the [full event list](https://paystack.com/docs/payments/webhooks/). The [Manual payouts support article](https://support.paystack.com/en/articles/2131074) describes something different — the *main* account settling to a Paystack balance, available to registered ZA businesses with at least a month of transaction history — not subaccount release.

**So the mechanism at the centre of the target model is undocumented in both directions: we cannot verify how to set it and we cannot verify how to use it.** That is not a reason to abandon the direction. It is a reason that M5-00 below is a written exchange with Paystack rather than a coding task, and that no schema is migrated until it is answered.

### 1.4 `is_verified` — every organiser needs a click from us

From Paystack support, quoting their subaccount verification behaviour:

> When you create a new subaccount or update an existing subaccount, **the first payout will be delayed indefinitely** to give you an opportunity to review and verify the subaccount and flag any unusual or suspicious activities. […] You'll be notified via email when a subaccount is created or updated, and you'll be able to verify one or multiple subaccounts in the Subaccount section of your Paystack Dashboard.

This is a **manual dashboard action by us, with no documented API**, and it fires again on every update — including, presumably, the update that sets `settlement_schedule: manual`. Every new organiser, and every organiser who corrects a typo in her account number, joins a queue that a person at Isipheko has to clear before her family sees a cent.

Two consequences the product has to absorb honestly:

- The onboarding copy cannot promise same-day settlement, and the dashboard's bank condition cannot read as met the moment the subaccount exists. `is_verified` from a Fetch is the real state and must be stored and shown.
- This is an operational commitment with an SLA attached, on the same footing as M3-06's one-working-day report promise. If nobody clears the queue on a Saturday, a funeral on Sunday does not get paid.

It is also, viewed from the other side, the fraud control that rule 13 says collections do not have. On events we now have two: verification gates publishing, and a human looks at every beneficiary bank account before it is ever paid. That is worth saying out loud in the security copy, in the *protects* voice.

### 1.5 The split, and how the money actually moves

Two products, and we need the simpler one.

**Single-subaccount split** ([Split Payments](https://paystack.com/docs/payments/split-payments/)). Pass `subaccount: "ACCT_xxx"` to Initialize Transaction. The split follows the subaccount's `percentage_charge`. Two per-transaction overrides exist on [Initialize Transaction](https://paystack.com/docs/api/transaction/):

- `transaction_charge` · Integer · *"An amount used to override the split configuration for a single split payment. If set, the amount specified goes to the main account regardless of the split configuration."*
- `bearer` · String · `account` or `subaccount`, default `account` — who pays the Paystack fee.

**Multi-split** ([Multi-split Payments](https://paystack.com/docs/payments/multi-split-payments/)). A named `split_code` over several subaccounts, `flat` or `percentage`, created ahead of time. We have one beneficiary per transaction and no need for it. Its constraints are worth knowing anyway: no decimals on percentage shares, percentage shares must sum to ≤ 100, flat shares must sum to ≤ the transaction amount, a split cannot be both types, and a split's type cannot be changed after creation.

The support article on splits mentions *"creating a split group on the fly"* and links to documentation on **Dynamic Splits**. That page is not in the current documentation navigation and `split` is not a documented parameter on Initialize Transaction. **[SILENT]** We do not need it — `transaction_charge` gives us a per-transaction variable amount to the main account, which is exactly the tip — but if it exists it is worth knowing, because it is the only shape that would let a single transaction carry a third party.

**Settlement direction.** Paystack settles each party's share to its own bank account on its own schedule; the subaccount's share does not transit our payout account. Each subaccount carries its own settlement schedule, so the main account and a subaccount can settle on different days. This is the mechanic the brief is buying and it holds up.

**One sharp edge from the support article, worth a comment in the adapter:** if a subaccount with a pending payout is deleted or deactivated, *"the outstanding payout to the account will not be processed to your main account. It will only be processed when the subaccount is reenabled."* Deactivating an organiser's subaccount strands her family's money. Nothing in this product may deactivate a subaccount that has an unsettled balance.

### 1.6 Channels, and the PayShap hole

From [Initialize Transaction](https://paystack.com/docs/api/transaction/), `channels` accepts `["card", "bank", "apple_pay", "ussd", "qr", "mobile_money", "bank_transfer", "eft", "capitec_pay", "payattitude"]`.

Available in South Africa, per [Payment Channels](https://paystack.com/docs/payments/payment-channels/):

| Channel | Note | ZA cost ([pricing](https://paystack.com/za/pricing)) |
|---|---|---|
| Card | Visa/Mastercard; Amex in ZA | 2.9% + R1, R1 waived under R10 |
| `capitec_pay` | *"available to businesses in South Africa only"* — push notification into the Capitec app, authorised by phone number, ID or account number | **2%, no flat fee** |
| `eft` | *"only available to South African customers"*; *"Ozow is currently the only provider available"* — redirect to internet banking | **2%, no flat fee** |
| `qr` | SnapScan and Scan to Pay, ZA only | — |
| Apple Pay | — | — |

**PayShap is absent.** Not deprioritised — absent from the channel enum, absent from the ZA channel documentation, absent from pricing. Phase 1.5 §1 ranked PayShap first on the evidence that 80% of its ~45m monthly transactions are under R500, which is precisely our basket, and Mode A was built on it (`payDetailsCopy.numberLabel`, *"Your PayShap number or cellphone number"*).

At R50 — an ordinary contribution — card costs the transaction 2.9% + R1, which is 4.9%. Capitec Pay at 2% costs R1. A direct PayShap transfer costs the contributor whatever her bank charges and costs the family nothing. **On the smallest and most common contribution, the rail we already built is the cheapest one available, and it is not on Paystack.**

This is the strongest single argument for keeping Mode A. Recommended channel order for hosted events: `capitec_pay`, `eft`, `card`, `qr` — cheapest and least reversible first — with the Mode A PayShap instructions still reachable on the same page.

### 1.7 Webhooks

From [Webhooks](https://paystack.com/docs/payments/webhooks/):

- `x-paystack-signature` is an **HMAC SHA512** of the raw event payload signed with the secret key. Verify before parsing. The route handler must read the raw body, not a parsed one.
- Source IPs: `52.31.139.75`, `52.49.173.169`, `52.214.14.220`, identical in test and live.
- Retries: without a `200 OK`, live events retry every 3 minutes for 4 tries, then hourly for 72 hours. Test mode retries hourly for 10 hours with a 30-second timeout.
- Return `200` immediately; do not do work inside the handler.

Events that matter to us: `charge.success`, `charge.dispute.create`, `charge.dispute.remind`, `charge.dispute.resolve`, `refund.processed`, `refund.failed`.

**There is no settlement event.** No `settlement.success`, no `subaccount.*`, nothing. A ledger driven by webhooks can confirm a **contribution** and nothing else; the state of a payout to an organiser's bank account can only be learned by polling List Settlements. Whether that endpoint even reports subaccount settlements is **[SILENT]** and goes to Paystack.

### 1.8 The terms, and the clause that ruled out PayFast

Paystack South Africa is *"licensed by the Payments Association of South Africa (PASA) to operate as a third party payment provider"* — [ZA Merchant Services Agreement](https://paystack.com/za/terms). Under card payments, Section B clause 1:

> The Card Schemes restrict us from onboarding another payment service provider as a Merchant. **In view of this, you must refrain from acting as a payment service provider and providing any form of payment aggregation services.**
> A breach of this clause is a material breach of this Agreement and Paystack may immediately terminate this Agreement and your Paystack Account in such event.

This is the same shape as the PayFast clause that ruled PayFast out. It is **narrower** — it sits inside the card-payments section and is justified by Card Scheme Rules rather than stated as a general prohibition — and it sits in an agreement whose author sells a subaccount product built for marketplaces. But our sub-beneficiaries are private individuals hosting funerals, not merchants, and the clause does not distinguish. **This must be raised with Paystack in writing, describing the product accurately, before a line of adapter code is written, and the answer kept.** It is exactly the question that killed the previous option, and discovering the answer after launch is discovering it in the form of a terminated account with an unsettled balance in it.

Two further clauses with product consequences:

**Merchant of record.** Same section: *"the Cardholder must understand that you, the Merchant, are responsible for the Transaction, delivery of the products or services sold, for customer service and dispute resolution applicable to the Transaction."* And: *"High Dispute rates (typically those exceeding 1% total payment volume) may result in your inability to accept Card Payments."* Chargeback windows run to 120 days; our settlement release to the organiser will be days. **A reversed card contribution is our loss, after the family has been paid**, and enough of them costs us card acceptance entirely. This is a real reason to put Capitec Pay and EFT ahead of card rather than merely a cheaper one — both are push payments authorised in the payer's own banking app.

**Donations are contemplated.** *"Paystack is not responsible for the products or services you publicize or sell, or that your Customers purchase using the Services; or if you accept donations, for your communication to your Customers of the intended use of such donations."* Donations are named in the eligibility and warranty clauses too. The Restricted Business List must still be read; it is published separately and was not fetched for this document.

### 1.9 Account resolution replaces Stitch BAV, and it is weaker

Paystack's [Verification API](https://paystack.com/docs/api/verification/) has **Resolve Account** — account number plus bank code returns the account details — and per Paystack's identity-verification documentation it is available to South African businesses and free. Not all banks support it; [List Banks](https://paystack.com/docs/api/miscellaneous/) takes `enabled_for_verification` and each bank object carries `supported_types`.

**It resolves a name. It does not match an ID.** Architecture §0.1's whole finding was that Stitch BAV verifies an account against a 13-digit SA ID and returns `identityDocumentMatch`, `initialMatch`, `lastNameMatch`, `accountAcceptsCredits`. Paystack returns the account holder's name as the bank has it, and we compare it ourselves to the Home Affairs name M3-01 already verified.

That comparison is fuzzy in every way that matters here — initials against full names, married names, a joint account in a husband's name, a bank record twenty years stale. Part F and `dashboardCopy.payout.conditions.bank.protects` — *"We check the account belongs to the same verified name"* — is now a claim about a string comparison we perform, not about a check a bank performed. The copy has to say what it actually does, and the failure path has to be a human review rather than a refusal, because refusing a grieving family over a middle initial is the failure this product cannot afford.

**Part F needs rewriting, not editing.** It reconciles the design's R1 test deposit against Stitch BAV; both sides of that reconciliation are gone.

---

## 2. Mapping the change onto this codebase

### 2.1 The interface, and where it lives

Following the shape `SmsSender`, `IdentityVerifier` and `ObjectStore` already use — declared in `src/domain/`, implemented in `src/adapters/`, constructed by a factory that refuses to build in production without a real provider:

```
src/domain/payments/
  provider.ts      the interface and its result types — no Paystack vocabulary
  amounts.ts       what a contributor pays vs what reaches the family
  index.ts
src/adapters/payments/
  in-memory-provider.ts
  paystack-provider.ts     the only file in the codebase that knows the word Paystack
  index.ts
```

Architecture §5.1's five methods were shaped around Stitch and three of them do not survive. `createDisbursement` and `getDisbursementStatus` describe instructing a credit transfer out of a float — the thing we are moving away from — and must not be carried across, or somebody will implement them. The shape that fits:

| Method | Paystack call | Notes |
|---|---|---|
| `resolveAccount` | Resolve Account | Returns the bank's name for an account. Never an ID match. |
| `createBeneficiary` | Create Subaccount, then Update Subaccount | Two calls, one operation. Not complete until a Fetch reads back `manual`. |
| `beneficiaryStatus` | Fetch Subaccount | Carries `is_verified`, the thing that actually gates a first settlement. |
| `startPayIn` | Initialize Transaction | Returns a URL to redirect to, an opaque reference. |
| `verifyWebhook` | HMAC SHA512 over the raw body | Returns a parsed domain event or nothing. |
| `releaseSettlement` | **unknown** | §1.3. Do not write this method until Paystack answers. A stub that throws is honest; a guess is not. |
| `settlementStatus` | List Settlements | Polled, because there is no event. |

The ESLint boundary rule that keeps `src/domain/` pure (M1-01 §4) needs a sibling for rule 10: nothing outside `src/adapters/payments/` may import the Paystack client or name its types. `tests/unit/domain-boundary.test.ts` is where that assertion belongs.

### 2.2 What happens to M2-05's self-report flow

**It stays, and this is the recommendation the rest of the plan hangs off.**

Three reasons, in order of weight. PayShap is not on Paystack and is the cheapest rail for a R50 contribution (§1.6). A hosted checkout is a redirect to another origin, and the contributor this product is built for has 40MB left on a borrowed phone — Mode A's pay step is a number and a code on a page that has already loaded. And a subaccount cannot take money until a person at Isipheko has clicked Verify (§1.4), so every organiser has a window between publishing and being payable in which Mode A is the only thing she has.

So `events.mode` finally means something. `ledger_only` is today's flow, unchanged. `hosted` is the new one. **The transition is per event and it is one-way**: an event goes hosted when its organiser has a verified subaccount, and the pay step then offers the hosted route *and* keeps the direct-pay instructions beneath it, because a contributor who cannot or will not use a card must still be able to give.

What changes inside M2-05:

- `canReachPayStep` in `src/domain/contribution/flow.ts` currently asks only whether `direct_pay_details` exists. It has to answer for two modes: a hosted event needs a verified subaccount, a ledger-only event needs the number. An event with neither still shows `noNumberTitle`, unchanged and still correct.
- The row is still created when the pay step is reached, for the reason M2-05 §3 gives — a reference needs something to be unique against. Under hosted mode our Paystack `reference` is that same code, which is a small piece of luck: `MTH-4K7B2X` satisfies Paystack's *"only `-`, `.`, `=` and alphanumeric characters allowed"* and it is already unique on `(ref_prefix, ref_code)`. One reference, one meaning, on the family's bank statement and in Paystack's dashboard.
- `self_reported_at` stays and keeps its exact meaning. A webhook-confirmed contribution never sets it, so it stays out of the confirmation queue by the mechanism that is already there. M2-05 §7 made that query the decider and the mapping a follower; that decision now does load-bearing work it was not written for.

### 2.3 The confirmation queues in M2-05 and M3-08

They do not empty. They **narrow**, and they must narrow rather than branch.

Today's queue holds two kinds: self-reported payments, and in-kind deliveries. In-kind is untouched — nobody pays for a tent through a checkout, `confirmDelivery` is still the organiser's confirmation, and M2-06 §1's in-kind ledger entry is unchanged. On a hosted event the payment half thins out to whoever still paid by PayShap and said so.

M3-08 §7 made these one interleaved list on the grounds that two lists put deliveries below payments. That still holds and gets stronger: on a hosted event with a handful of self-reports and a dozen deliveries, a payments-first split would be a mostly-empty card above the work.

The copy that has to change is `dashboardCopy.queue.tail` — *"Check each against your own bank message, then say yes. It is the only thing on this page that needs you today."* — and `queue.checkAgainst`. Both are true of a self-reported row and false of nothing else, since nothing else reaches the queue. They stay as written and become **per-row rather than per-section**. The section's own words have to stop claiming that everything below needs checking against a bank message.

**Nothing about a webhook-confirmed contribution may enter this queue.** A row an organiser can "confirm" when it was already confirmed by a webhook is a row she can be wrong about, and the whole value of the queue is that her yes means something.

### 2.4 The ledger

The append itself is untouched, and that is the point of M2-01. What changes is what triggers it.

Today: the organiser's confirmation is the only thing that writes to the ledger (M2-05 §4). Tomorrow, on a hosted event: `charge.success` is. Both write one credit entry through the same function, and `verification_source` — already `organiser_confirmed | psp_webhook` in the schema — is the only difference, exactly as architecture principle 5 said it would be.

Four things to get right:

**Idempotency.** `contributions.psp_payment_id` is already `@unique`. A webhook retried for 72 hours must produce one entry. The conditional-update posture M2-05 §4 established — confirm only if still pending — is the mechanism, and the unique index is the backstop. Same two-layer shape as the claim path, and the second layer is the database, which M2-05 §7 is careful to say is the only kind of redundancy worth having.

**`created_at` is supplied by the application, and there is a new trap.** The hash covers it (M2-01 §3) and CLAUDE.md's working agreement makes this a rule. The webhook payload carries Paystack's own timestamp, and it will be tempting to use it. Do not, without deciding deliberately: the 72-hour hold reads this column (M3-08 §3), and a provider-supplied time makes the hold window depend on a clock we do not control and cannot simulate. Pass the application's `now`, and keep Paystack's timestamp as data on the contribution row if it is wanted for reconciliation.

**A dispute is a reversal, not an edit.** `charge.dispute.resolve` against us reverses a contribution that is already on the chain. Rule 3 says that is a new `reversal` entry, and M2-01 §6 already has a reversal pointing at the entry it reverses. This is the first time in the product's life that something outside it can reverse a ledger entry, and the strand, the album and the dashboard all have to be right about what that looks like. M4-02 §4 already excludes reversed entries from the album; nobody has ever tested it with a reversal that arrives three weeks later.

**The amount on the entry is the contribution, never the contribution plus tip.** See §4.

### 2.5 `splitBalance` and the four conditions: from explaining to gating

Yes. Both. And the change is larger than it looks.

`splitBalance` is already correct arithmetic and needs no logic change — M3-08 §3's care about `bigint` subtotals, reversals taking a subtotal negative, and `clearsAt` being the oldest fenced entry all pay off here. What changes is that its output stops describing money that is already somewhere and starts deciding whether money moves. `available` becomes the amount a settlement release would draw. The doc comment in `src/domain/payout/balance.ts` that says *"Mode A has no held balance […] nothing in this product may render it as a balance we hold"* becomes false for hosted events and has to be rewritten rather than deleted, because it stays true for ledger-only ones.

`payoutConditions` gains its first caller. `payoutReady` — which M3-08 §5 built and then asserted nothing calls — becomes the gate it was written to be. Condition by condition:

| Condition | Today | Under Paystack |
|---|---|---|
| `identity` | Met on any published event; unmet on a draft | Unchanged. Still M3-01, still the only one with a button today. |
| `bank` | **Unmet for everybody, forever.** Nothing writes `bank_accounts`. | Becomes real, and becomes **two** facts: a resolved account name we compared to the verified name, and Paystack's `is_verified` on the subaccount. Both must be true. `notYet` is deleted. |
| `hold` | Explains a window nobody acts on | Decides whether a release is triggered, and for how much. |
| `witness` | *"Nothing to ask for yet, because there is no payout to agree to."* | Becomes a real approval with a real consequence. `notYet` is deleted. `RESERVED_PAYOUT_ACTIONS` in `src/domain/audit/actions.ts` stops being reserved. |

**The bank condition splitting into two facts is the substantive change**, and it needs its own thinking rather than a boolean. A subaccount can exist, resolve to a name that matches, and still be unable to receive a first settlement because nobody at Isipheko has clicked Verify. Telling an organiser her bank account is verified when her first payout is queued behind our internal review would be the M1-08 §5 failure on the screen where money is counted — the thing M3-08 was largely written to avoid. `PayoutFacts.bankVerified` should become two named facts, and the copy should be able to say *"your account checked out; we are looking at it, which takes up to one working day"* without either lying or leaving a dead end.

### 2.6 Schema

Everything needed is close to what exists.

**`bank_accounts` fits with no shape change.** It already has `bank_id`, an encrypted account number, `bav_result` as immutable JSONB, `bav_verified_at`, a status, and a partial unique index giving one active account per organiser. Store the Paystack bank code in `bank_id` and the Resolve Account response in `bav_result` — it is still *the evidence that we checked before paying*, which is what the column is for. What it lacks is somewhere to put the subaccount code and `is_verified`; two columns, or one JSONB, and the decision is which reads better in five years.

**`payouts` needs rethinking, not extending.** Its `status` enum mirrors Stitch's disbursement states and `psp_disbursement_id` names an object that will not exist. Under Paystack a row here is a **settlement release request** — what we asked for, when, on whose approval, drawing which fenced portion — and its outcome is learned by polling rather than pushed. `nonce` survives as the idempotency key on whatever the release call turns out to be. This table is empty and always has been, so a migration is cheap; what is not cheap is a table whose column names describe a provider we rejected.

**`contributions` needs `tip_amount_cents`.** Nullable, outside the hash chain, never rendered on any family-facing surface. §4.

**`events.mode` and `direct_pay_details` both stay.** They were built for this.

### 2.7 The public page, the budget, and JavaScript

Use the **redirect** checkout, not Paystack's inline script.

Initialize Transaction returns an `authorization_url`. A `<form method="post">` on the pay step posts to our own route handler, which calls Paystack server-side and answers `303` to that URL. **No client JavaScript, no third-party script tag, no change to the 150KB ceiling**, and the flow keeps working with JavaScript disabled — which rule 5 requires of claiming and which M2-05 §8 chose for the whole contribution path for the same measured reason. `/e/[slug]` stays at 35.9KB.

Paystack's InlineJS would put a script from `js.paystack.co` on the page a contributor loads on a prepaid bundle, in exchange for a modal instead of a redirect. That is not a trade this product makes. `scripts/size-gate.ts` should assert the absence by name, the way M2-08 §8's WhatsApp scan asserts absences: no `js.paystack.co`, no `PaystackPop`, anywhere under `src/app/(public)/`.

### 2.8 The contributor has no email address, and Paystack requires one

`email` is a **required** parameter on Initialize Transaction. Rule 4 says a contributor never authenticates, M2-05 §8 says *"an email address is never asked for at all, because it is the field that turns into an account"*, and `tests/e2e/contribute.spec.ts:195` walks every step asserting that no control's type, name, id, placeholder, autocomplete or text contains `email`, with zero `input[type=email]`.

**Resolution: synthesise one server-side and never show it.** `c-<contribution-id>@receipts.isipheko.co.za`, on a domain that accepts nothing. It is not asked for, not displayed, not stored as a contact, and not deliverable. The E2E test passes unchanged because it scans rendered controls; it should nonetheless gain an assertion that the address the adapter builds is derived from the contribution id and contains nothing the contributor typed, so that a later "we may as well use their real address if they gave one" is caught by a test rather than by a person.

**And nothing else about the contributor goes to Paystack.** No name, no phone, no message, no metadata. Rule 8's discipline is an allowlist, not a denylist, and the allowlist for the payment payload is: amount, currency, reference, channels, subaccount, `transaction_charge`, the synthetic email. A POPIA operator agreement with Paystack is a separate item and belongs with the legal work.

---

## 3. What breaks

### 3.1 Copy that becomes untrue

This codebase removes copy the moment it stops being true — M1-08 §5, M2-07 §5, M3-03 §8, M4-02 §4. Every string below is affected. Most are true of a `ledger_only` event and false of a `hosted` one, which means the answer is usually a mode-keyed variant rather than a deletion, and `src/copy/` is keyed by archetype today and will need a second axis.

**`src/copy/contribute.ts`**

| Line | String | What happens |
|---|---|---|
| 8 | File header quoting the pay-step foot as an example of the honest voice | Rewrite; the example is about to stop being universally true |
| 81 | `pay.intro` — *"Open your bank or PayShap, send the amount to this number with this reference, then come back and tell us."* | Ledger-only only. Hosted needs its own. |
| 83–88 | `numberStep`, `referenceStep`, `amountStep`, `referenceHelp`, `copyNumber`, `copyReference` | Ledger-only only |
| 90 | `pay.foot` — ***"Nothing is taken from you here. You send it yourself, from your own app."*** | **Flatly false on a hosted event.** Money is taken there, on that page. |
| 91 | `pay.submit` — *"I've paid"* | A claim about the world. On hosted the action is *"Send my contribution"* — which is the Voice table's own example, and the action keeps its name through the redirect and back. |
| 98–100 | `noNumberTitle`, `noNumberBody` | Still correct for ledger-only. Hosted needs a sibling for *"her account is not payable yet"*, which is a different fact with a different remedy. |
| 114 | `done.body` — *"It joins the record when they confirm it."* | On hosted it joins when the payment clears, in seconds. M4-02 §4 fixed this string once already, in the opposite direction. |
| 117 | `done.pending` — *"The family will confirm it against their own bank notification."* | False on hosted |
| 149 | `payDetailsCopy.intro` — *"Mode A: people pay you directly from their own banking app. Isipheko never holds the money…"* | Rewrite. Also **"Mode A" is system vocabulary that reached the interface** and should not have. |
| 152–155 | `numberLabel`, `numberHelp`, `nameLabel`, `nameHelp` — all about a PayShap number | Gain siblings for bank account number and bank, on the same screen |

**`src/copy/event.ts`**

| Line | String | What happens |
|---|---|---|
| ~198 | `moneyBody` — ***"Nothing on this page can take money from you yet. When contributing opens, you will be told exactly where your money goes before you send it."*** | **The most dangerous string in the change.** It is on the trust panel, on the page a contributor reads immediately before paying. Rewrite to say where the money actually goes: to the family's own bank account, through a licensed provider, and that we take only what she chose to add. |
| 6–24 | File header, item 1, explaining why the prototype's held-account line is not shipped | Rewrite, not delete. The prototype said *"a held Isipheko account"*; that is **still untrue** — funds sit with Paystack, allocated to the family, and never with us. The note now says something more precise and more useful. |
| ~211 | `wrongBody` and its doc comment — the half-sentence about holding payments on a reported page, removed at M3-04 because no payment passed through us to hold | **Do not restore it.** Under manual settlement we could technically withhold a release on a reported event, and that is precisely the widening this document must refuse: M3-06 §1 is a STANDING RULE that a report does nothing by itself, proved at M3-06 and again at M3-07. Restoring the promise would make triage into a payment control. The doc comment's *reason* changes — it is now a choice rather than an impossibility — and saying so is the whole value of writing it down. |

**`src/copy/dashboard.ts`**

| Line | String | What happens |
|---|---|---|
| 142 | `money.intro` — ***"People pay you directly, so this money is already in your own account."*** | **False on a hosted event, and false in the exact way M3-08 §1 was written to prevent** — an organiser makes a promise or buys something on the strength of a number describing money she does not have yet. This is the string to get right before any other. |
| 158–160 | `available` / `availableNote` — *"Settled"*, *"past the window in which a payment can be reversed"* | On hosted, "settled" has to mean *paid out to your bank*, which is a different fact from *past the reversal window*. Two facts, two labels, or one label that is honest about which it means. |
| 163 | `inKindNote` | Unchanged, and still right |
| 46 | `queue.tail` — *"Check each against your own bank message"* | Per-row, not per-section (§2.3) |
| 60 | `queue.checkAgainst` | Stays; applies to self-reported rows only |
| ~186 | `payout.intro` — *"Nothing is paid out through Isipheko yet, so there is nothing here to ask for."* | False. The section stops being an explanation and becomes a form. |
| ~203 | `conditions.bank.remedy` — Part F's Stitch BAV wording | Replaced. Resolve Account is a different check with a different promise (§1.9). |
| ~208 | `conditions.bank.protects` — *"We check the account belongs to the same verified name"* | Only true if we say what we actually do: compare the name the bank returns to the name Home Affairs confirmed. |
| ~210 | `conditions.bank.notYet` | Deleted |
| ~231 | `conditions.witness.notYet` — *"Nothing to ask for yet"* | Deleted |
| 8–31 | File header, items 1 and 3, and *"The rule this screen is written against"* | Rewrite. The rule survives and gets sharper: no figure may be presented as money she has when it is money she is owed. |

**`src/copy/collection.ts`** — nothing becomes untrue. §3.3.

**`src/domain/payout/balance.ts:23–32`** and **`src/domain/payout/conditions.ts:36–44`** — both doc blocks describe a world with no payout. Both become mode-dependent. These are not comments; in this codebase they are where the reasoning lives, and a stale one is worse than none.

**Part F of the implementation plan** — rewrite entirely (§1.9).

### 3.2 Tests that assert current behaviour

| Test | Assertion | What happens |
|---|---|---|
| `tests/unit/dashboard.test.tsx` | The page contains no request button at any state | Becomes: none on a ledger-only event; one only when `payoutReady`. The assertion must not simply be deleted — it is the guard M3-08 §1 built. |
| `tests/unit/payout-conditions.test.ts` | Each of the four has a state in which it is unmet | Survives, and must be re-proved with `bank` split into two facts |
| M3-08 §5's assertion that nothing calls `payoutReady` from the UI | Inverts |
| `tests/e2e/contribute.spec.ts:195–247` | No account, no password, no email on any step | Survives (§2.8), and gains an assertion about the synthesised address |
| `tests/e2e/contribute.spec.ts` pay-step walk | Copy-the-number, copy-the-reference | Needs a hosted branch against a stubbed provider. The redirect leaves our origin, so the E2E stops at the redirect and resumes at the webhook. |
| `tests/integration/contribution.test.ts` | self-report → confirm → ledger entry | Gains a webhook path, including a replayed webhook producing one entry |
| `tests/integration/dashboard.test.ts` | The three money figures and their labels | Both modes |
| `tests/integration/collections-no-money-path.test.ts` | Forbidden-column regex on `collections`; a code scan that catches a `payOutCollection` repository function | **Widen both.** Add `subaccount`, `paystack`, `split_code`, `beneficiary` to the column pattern and to the code scan. §3.3. |
| `tests/unit/collection-page.test.tsx:110–114` | The custody scan for *"we hold"*, *"held safely"*, *"protected"*, *"guarantee"*, *"escrow"* | Unchanged, still passes, and now guards more — the pressure to soften it goes up the moment the event page can take money. |
| `tests/unit/trust-panel.test.tsx` | The event page's money line | Changes with `moneyBody` |
| `tests/unit/audit.test.ts` | `RESERVED_PAYOUT_ACTIONS` are reserved and absent from the union | Inverts; the three actions become real |
| `tests/unit/domain-boundary.test.ts` | `src/domain/` imports nothing from `app/`, `adapters/`, `db/` | Gains rule 10's boundary: no Paystack outside `src/adapters/payments/` |
| `scripts/size-gate.ts` | 150KB on `/e/[slug]`, 31.6KB on `/c/[slug]` | Unchanged, and gains a no-third-party-script assertion |

### 3.3 Standing rules

**None of the sixteen breaks.** Taken one at a time, because the brief asked and because the answer for collections is the one that matters:

- **1 (bereavement)** — untouched. One new surface to watch: the tip prompt appears on a funeral contribution, and its wording is archetype-keyed like everything else. No percentage suggestions computed from the amount; §4.
- **2 (accent as fallback)** — untouched.
- **3 (append-only)** — untouched, and exercised harder. A dispute reverses an entry from outside the product for the first time; the correction is a `reversal`, never an edit.
- **4 (contributors never authenticate)** — under real pressure from the required `email` field, and it holds by synthesising one (§2.8). Worth stating explicitly in decisions, because the shortcut — asking for an address "for the receipt" — is one honest-sounding sentence away.
- **5 (claiming never optimistic)** — untouched. In-kind never goes through a checkout.
- **6 (`src/domain/` is pure)** — untouched, plus a new boundary.
- **7 (integer cents)** — Paystack takes amounts in subunits; conversion at the adapter boundary only, as M1-03 and architecture §4.4 already require.
- **8 (no PII in plaintext)** — a new outbound surface. The allowlist for the payment payload is in §2.8, and a POPIA operator agreement is now needed.
- **9 (150KB)** — holds, because of the redirect (§2.7).
- **10 (payment code behind the interface)** — becomes real instead of aspirational.
- **11 (copy in `src/copy/`)** — holds, and the copy layer needs a mode axis alongside the archetype one.
- **12, 13, 16 (collections)** — **hold, unchanged, and the analysis strengthens rather than threatens them.** In detail:

**Rule 12 — a collection has no payout, float or disbursement.** Nothing in this change gives it one. A collection would acquire a money path only if the collection organiser were given a subaccount so members could pay on her page — and that is precisely us collecting money for on-payment to a third person, the exact activity §0.2 is asking a lawyer about, and it would also put a private individual squarely inside the aggregation clause in §1.8. It is the obvious next idea and it must be refused in writing before somebody has it. The tripwire test M2-09 §7 built — which catches a `payOutCollection` function by name — should be widened now, before the temptation exists, to catch `createCollectionSubaccount` and anything else naming a beneficiary on a collection.

**Rule 13 — verification gates sharing, not payout.** Unchanged. There is still no payout on a collection to withhold, so the absence of a shareable link is still the only leverage that exists. Note that events now gain a *second* control — the subaccount review in §1.4 — which widens the gap between the two roles rather than narrowing it. That asymmetry is real and correct, and the collection screens should not be made to look like the event screens to hide it.

**Rule 16 — the copy must say the organiser holds the money.** Every string survives verbatim: `collectionCopy.custodyTitle`, the trust panel's *"Isipheko never receives it, never holds it, and cannot refund it"*, the join flow's *"Isipheko does not take it and cannot pass it on for you"*. What changes is the reader's context. **Once a contributor can pay with a card on an event page, "why can't I do that here?" becomes a question the collection page has to answer**, and if it does not, the silence reads as a page that is broken rather than a page that is honest. That is one new sentence, in the same voice, explaining that this money is hers and never touches us — and it is the only collection copy change in this whole document.

- **14 (one entry per collection)** — untouched.
- **15 (host does nothing at handover)** — untouched.

**One decision that is not a rule but reads like one, and is now at risk:** M2-10 §9 explains that `contributions.collection_id` is unused by design, and that the only thing that would need it is *"a member paying through the product rather than to the organiser — which is Mode B and rule 12's opposite."* That reasoning was written before there was a Mode B to build. It is now a live temptation with a column already sitting there waiting for it. The entry stands and should be pointed at from the new work.

---

## 4. The tip

### 4.1 Where it sits

**On the amount step, not the pay step.** Three reasons.

The amount step is the money screen; the pay step, under hosted mode, is the moment of commitment and the last thing before leaving our origin. Putting a second money decision at the point of commitment is where dark patterns live, and this product's whole claim is that it is not one of those. Mechanically, we must know the tip **before** calling Initialize Transaction, because it is a parameter of that call — so it cannot be a decision made at the redirect. And it belongs beside the contribution amount, where the contributor can see the two numbers together and say no to one of them.

It is shown again on the pay step as a line in the total, not as a control. Changing it means going back, which is one tap and works with JavaScript off, like every other step of this flow.

**Never pre-selected. Never a default. Never a percentage.** Fixed small rand amounts, a custom field, and an option that is not phrased as a refusal — *"Just my contribution"* rather than *"No thanks"*. A percentage chip computed from the contribution turns a funeral contribution into a bill with a service charge on it, and on the bereavement archetype the whole block wears the plainest wording it has.

Two things it must say, because the security-copy rule is that copy explains what something protects rather than what it does: that the family receives the same amount either way, and that this is what pays for the page. If both are true, say them. If the first is not true — see §4.3 — do not build the tip until it is.

### 4.2 How it is taken

`transaction_charge`, the per-transaction flat override on Initialize Transaction (§1.5):

```
subaccount:         percentage_charge = 0        (our default share is nothing)
initialize:         amount            = contribution + tip
                    subaccount        = ACCT_xxx
                    transaction_charge = tip
                    bearer            = "account"
```

The subaccount receives `amount − transaction_charge`, which is the contribution exactly. We receive the tip. No split object, no `split_code`, nothing to keep in sync.

Three unverified edges, all cheap to settle in the sandbox and all worth settling before the copy is written:

- **`transaction_charge: 0` when the contributor declines.** Undocumented. **[SILENT]** The alternative is omitting the parameter entirely — but the split guide says *"if the main account receives a 0% percentage deduction, the subaccount gets charged the transaction fee"*, which means the two branches would differ in who pays Paystack. Both branches must be tested; the answer decides whether `bearer` can be left to its default.
- **`bearer: "account"` when our share is zero.** The docs warn that specifying a bearer requires the receiving side to have enough to cover the fee, and returns `400` if not. That warning is written about `bearer: "subaccount"`. Whether the reverse case is even valid is **[SILENT]**.
- **Minimums.** ZA pricing waives the R1 flat fee under R10 but says nothing about a floor on a split. A R20 contribution with a R2 tip against a 2.9% + R1 card fee is close enough to the edges that it should be run rather than reasoned about.

### 4.3 Who pays Paystack, and why the answer is us

`bearer: "account"` — we absorb the Paystack fee — for one reason: **the ledger must be able to say what the family received.** If the fee comes off the subaccount's share, then the amount on the record and the amount in the family's bank account differ by 2–2.9% plus a rand, and the dashboard has to carry a fee line that an organiser reads on the day of a funeral. That is a worse product and a worse record.

The cost of that choice should be stated rather than buried: **a contribution with no tip loses us money.** At 2% on Capitec Pay, a R500 contribution with no tip costs us R10. This is not a rounding error and it is the number that decides whether the tip is a viable revenue model or a gesture. It also creates a pressure — toward a default tip, a pre-selected amount, a percentage — that this document is on record as refusing. If the economics do not work with a genuinely voluntary tip, the answer is a different revenue model, not a less voluntary tip.

### 4.4 What it does to the ledger and the strand

**The tip is not on the ledger. At all.**

One credit entry per contribution, `amount_cents` = the contribution, tip excluded. The tip is not something the contributor gave the family and the ledger is the record of what the family received. Putting it on the chain would make the strand, the album, the incwadi and the dashboard all overstate by an amount that varies per bead.

Consequences, all of which fall out for free:

- **The strand.** Bead size bands are computed from the ledger amount, so they carry no tip. C.4's rule that bands are unlabelled *so amounts cannot be reverse-engineered* is preserved rather than complicated.
- **The album and the PDF.** Untouched. M4-03 §7 already guarantees no amount crosses into the renderer — `PrintableBead` carries a diameter, not a value.
- **The incwadi.** Untouched; a collection's incwadi lists what members put in, and collections have no tip because they have no checkout.
- **`splitBalance`.** Reads the ledger, so it sees contributions only. Correct without change.
- **The hash chain.** Unchanged, and it must be. M2-01 §2 pins the serialisation with a fixed vector and architecture §4.3 says the format cannot change. **A tip field must not be added to the hash.** It is not part of what was given.

Where the tip *is* recorded: `contributions.tip_amount_cents`, nullable, outside the chain, for reconciliation against Paystack's own settlement report and for knowing whether the model works. It must never render on the event page, the strand, the album, the incwadi, the PDF, the collection page, or the organiser's dashboard. A test asserting that — a scan of every rendered surface, in the shape of M4-03 §7's — is part of the task that adds the column, not a later cleanup.

---

## 5. Task breakdown

Part E style. One task per session, each with its own done-criteria, dependencies stated. Milestone 5.

**Two gates apply to the whole milestone and are stated once.** M5-00 gates everything. The legal opinion gates every task from M5-04 onward — anything that creates a beneficiary or moves money. M5-01 through M5-03 can be built against an in-memory provider before either lands, which is worth doing, because the interface is where the Stitch assumptions are still hiding.

---

**M5-00 · The three written answers**
*Deps:* none
*Not an agent task.* A Paystack account, a sandbox key, and three questions put in writing with the answers kept:
1. **How is a subaccount's `settlement_schedule` set, and how is a manual settlement released?** Both are undocumented (§1.3). Ask for the endpoint, the payload, and whether List Settlements reports subaccount settlements.
2. **Does our model fall foul of the aggregation clause?** Section B clause 1 of the ZA MSA (§1.8), described accurately: a platform initiating transactions on behalf of private individuals hosting family ceremonies, each a subaccount, with a voluntary tip as our share. This is the question that ruled out PayFast.
3. **Are natural persons acceptable as subaccount beneficiaries**, and what does the subaccount review in §1.4 actually require of us — turnaround, evidence, whether an API exists.
And separately, to a payments attorney, the question in §0.2 in both its halves: manual release, and auto.
*Done:* three answers in writing, filed in `docs/`. Item 1's answer decides whether the target model is buildable as described; items 2 and 3 decide whether it is permitted.

---

**M5-01 · `PaymentProvider` — the interface and an in-memory implementation**
*Deps:* M1-03
`src/domain/payments/` declaring the interface in §2.1, with no Paystack vocabulary and **no `createDisbursement`** — the float-shaped method does not cross over. `src/adapters/payments/in-memory-provider.ts`. `paymentProvider()` refuses to construct in production until a real one exists, the same posture as `identityVerifier()` and `whatsAppSender()`. `releaseSettlement` throws with a message naming M5-00 item 1, because a stub that guesses is worse than one that says it does not know.
*Done:* `pnpm typecheck && pnpm lint && pnpm test` green; the domain-boundary test gains rule 10's boundary and is proved to fail on a deliberate import of the adapter from `src/domain/`.

**M5-02 · Paystack adapter — initialize, resolve, subaccount**
*Deps:* M5-01, M5-00
The only file that names Paystack. Initialize Transaction with `channels` ordered `capitec_pay, eft, card, qr` (§1.6). Resolve Account plus List Banks with `enabled_for_verification`. Create-then-Update subaccount as one operation that is not complete until a Fetch reads back `manual` and reports `is_verified` (§1.3, §1.4). Amounts converted from `Money` at this boundary and nowhere else. **The outbound payload allowlist from §2.8 is enforced here, in code, not by convention.**
*Done:* every call exercised against the sandbox; a test asserts the initialize payload contains no contributor name, phone, message or real email; the `settlement_bank`/`bank_code` contradiction (§1.1) is resolved by experiment and recorded.

**M5-03 · The webhook route and idempotent confirmation**
*Deps:* M5-02, M2-01
`POST /api/paystack` — raw body, HMAC SHA512 verified before parsing, `200` returned before any work. `charge.success` confirms the contribution and appends one ledger entry in one transaction, `verification_source = 'psp_webhook'`, `created_at` supplied by the application (§2.4). Deduplicated on `psp_payment_id`. Never touches the confirmation queue.
*Done:* a replayed webhook produces exactly one ledger entry, proved by replaying it; an unsigned and a wrongly-signed body are both refused; a webhook for an unknown reference is refused without creating anything; integration tests run against a real database per the working agreement.

**M5-04 · Beneficiary onboarding — the organiser's bank account**
*Deps:* M5-02, M3-01, **legal opinion**
The organiser's screen for adding a bank account, on `/manage/[id]` beside the pay-details screen M2-05 built. Resolve the account, compare the returned name to the Home Affairs-verified name, **and treat a mismatch as human review, never as a refusal** (§1.9). Store in `bank_accounts` — encrypted number, the resolve response in `bav_result` as immutable evidence, the subaccount code and `is_verified`.
*Done:* an organiser can add an account and see honestly which of the two facts are true; a mismatched name reaches review rather than a dead end; no account number in any log; a test proves the plaintext number never leaves the encryption helper.

**M5-05 · Mode per event, and the two flows side by side**
*Deps:* M5-04
`events.mode` finally decides something. `canReachPayStep` answers for both modes (§2.2). A hosted event's pay step offers the hosted route **and keeps the direct-pay instructions beneath it**, because PayShap is not a Paystack channel and is the cheapest rail on a R50 contribution (§1.6). Copy from §3.1's `contribute.ts` rows, mode-keyed.
*Done:* both flows reachable on one event; a ledger-only event is byte-identical to today; `pnpm gate:size` unchanged on `/e/[slug]`.

**M5-06 · The hosted pay step — redirect checkout, no JavaScript**
*Deps:* M5-05, M5-03
A `<form method="post">` to our own route handler, which initialises server-side and answers `303` to `authorization_url`. Reference is the existing `MTH-4K7B2X` code. Email synthesised per §2.8. **No `js.paystack.co`, no `PaystackPop`, nowhere.**
*Done:* the whole path works with `javaScriptEnabled: false`; the size gate asserts no third-party script anywhere under `src/app/(public)/`; a contributor who abandons the checkout leaves a pending row that expires on the existing fourteen-day sweep.

**M5-07 · The tip**
*Deps:* M5-06
On the amount step, zero by default, no percentages, archetype-keyed wording (§4.1). Taken as `transaction_charge` with `bearer: "account"` (§4.2). `contributions.tip_amount_cents`, outside the hash chain. The three sandbox edges in §4.2 settled by experiment before the copy is written.
*Done:* a contribution with a tip produces a ledger entry for the contribution alone; a scan asserts no tip amount renders on the event page, strand, album, incwadi, PDF, collection page or dashboard; the declined-tip branch is tested against the sandbox, not reasoned about; the ledger's fixed test vector is unchanged.

**M5-08 · The dashboard's money section, rewritten for custody**
*Deps:* M5-06
The `money.intro` string in §3.1 is the task. Mode-keyed: ledger-only keeps M3-08 §1's wording verbatim; hosted says where the money actually is and when it can move. "Settled" splits into *past the reversal window* and *paid to your bank*, which are now two different facts (§3.1).
*Done:* no figure on either variant reads as money she has when it is money she is owed; M3-08 §1's no-request-button test survives for ledger-only events; the funeral countdown scan (M3-08 §2) still passes.

**M5-09 · The payout gate — conditions, request, audit**
*Deps:* M5-08, M3-03, **M5-00 item 1**
`payoutReady` gains its caller. `bank` splits into the two facts in §2.5. `RESERVED_PAYOUT_ACTIONS` stop being reserved: `payout.requested`, `payout.approved`, `payout.released` become real, with the two-actor shape `src/domain/audit/actions.ts:35` already anticipated. Witness approval above the threshold becomes a real approval. `payouts` reshaped from Stitch's disbursement states to a settlement release request (§2.6).
*Done:* every one of the four conditions still has a state in which it is unmet; a request below-threshold needs no witness and a request above it cannot proceed without one; every step is audited; the request is idempotent under a double tap.

**M5-10 · Settlement reconciliation**
*Deps:* M5-09
There is no settlement webhook (§1.7), so this is a polled job beside `pnpm notify`, `pnpm expire` and `pnpm render` — the pattern M2-08 §1 established and M4-03 §8 reused, still with no Redis. Reconciles requested releases against List Settlements and writes the ledger debit when one lands.
*Done:* a settled release writes exactly one debit; an unsettled one says so without guessing; two overlapping runs cannot double-write, by the same conditional-claim mechanism M4-03 uses.

**M5-11 · Disputes and reversals**
*Deps:* M5-03
`charge.dispute.create` and `charge.dispute.resolve`. A dispute resolved against us is a `reversal` entry pointing at the entry it reverses (M2-01 §6), never an edit. The organiser is told, in the *protects* voice, what happened and what it means — and the copy must not imply she owes us money, because whether she does is a question this task does not answer.
*Done:* a reversal three weeks after the fact leaves the chain verifiable; the reversed entry is absent from the album (M4-02 §4) and from `splitBalance`; the dispute rate is reportable, because 1% costs us card acceptance (§1.8).

**M5-12 · Collections — the asymmetry, said plainly, and the tripwire widened**
*Deps:* M5-06
One sentence on the collection page explaining why money cannot be paid there, in the same voice as the custody line (§3.3). The tripwire in `tests/integration/collections-no-money-path.test.ts` widened to catch `subaccount`, `paystack`, `split_code` and `beneficiary` in both the column pattern and the code scan, verified the way M2-09 §7 verified the last one — by adding the forbidden thing and watching the test fail.
*Done:* the collection page answers the question a contributor will now have; the custody scan at `collection-page.test.tsx:110` still passes unchanged; a `createCollectionSubaccount` function fails the suite.

**M5-13 · The untrue-string audit**
*Deps:* M5-05 through M5-12
Not a copy sweep at the end — every task above ships its own copy. This is the **test** that stops the next task reintroducing what these removed: a scan asserting that no string reachable from a hosted event claims the contributor pays the organiser directly, that no string claims Isipheko holds money, and that no string on any surface promises a settlement timetable. In the shape of M3-08 §2's countdown scan, with comments stripped so an explanation of an absence does not satisfy it.
*Done:* the scan fails on a deliberately reintroduced *"already in your own account"* on a hosted event; `pnpm typecheck && pnpm lint && pnpm test` green.

---

**Not in this milestone, deliberately:** anything that lets a report withhold a settlement (§3.1, M3-06 §1 stands); anything that gives a collection a beneficiary (rule 12); Paystack InlineJS (§2.7); a default or percentage tip (§4.1).

---

## 6. What remains open

**Blocking — nothing is built until these are answered.**

1. **How `settlement_schedule` is set and how a manual settlement is released.** §1.3. Undocumented in both directions. Owner: Paystack. If the answer is "you cannot", the whole target model changes shape and the fallback in §0.2 — `auto` settlement, no hold, conditions that explain rather than gate — becomes the design.
2. **The aggregation clause.** §1.8. Owner: Paystack, in writing. This is the question that ruled out PayFast and it has to be asked before, not after.
3. **The legal opinion, in both halves.** §0.2. Owner: payments attorney. Architecture §15 item 1 is superseded — the float is gone and the question is now about a discretionary release trigger over funds held by a licensed TPPP.

**Needed before the relevant task.**

4. **Natural persons as subaccount beneficiaries**, and what the subaccount review actually requires of us. §1.4. Gates M5-04, and creates an operational SLA the product does not yet have anywhere to put.
5. **Whether List Settlements reports subaccount settlements.** §1.7. Gates M5-10. If it does not, there is no way to learn that an organiser was paid, and the dashboard cannot say so.
6. **The three tip edges** — `transaction_charge: 0`, `bearer` with a zero share, minimums. §4.2. Sandbox, not correspondence. Gates M5-07.
7. **The `settlement_bank` / `bank_code` contradiction.** §1.1. Sandbox. Gates M5-02.
8. **Paystack's Restricted Business List for South Africa**, read rather than assumed. Not fetched for this document.
9. **A POPIA operator agreement with Paystack.** §2.8. New processor, new outbound personal-data flow, however narrow the allowlist.

**Product decisions that are ours.**

10. **Whether the tip can carry the cost.** §4.3. A no-tip contribution loses us 2–2.9% plus a rand. This is the number that decides whether the model works, and the pressure it creates — toward a default, a pre-selection, a percentage — is the pressure this document is on record as refusing. Decide it with real numbers before the copy is written, not after.
11. **The `WITNESS_APPROVAL_THRESHOLD`.** Part J item 8 says R5 000 was invented by the dashboard design and should move when there is evidence. It stops being decorative in M5-09 and starts stopping payouts. It needs a number somebody has defended before then.
12. **What happens to Mode A in the long run.** This document recommends keeping it, on the strength of PayShap's absence and the data cost of a redirect. That recommendation should be re-examined the day Paystack adds PayShap as a channel, and not before.

**Superseded by this analysis, if it is accepted.**

- Architecture §0.1 and §0.2, §5.1 through §5.6, §15 items 1, 2, 3, 4 and 12 — all written about Stitch.
- Implementation plan Part F, entirely.
- Part J item 1.

**Not superseded, and worth saying:** architecture §1's seven principles all survive intact, including principle 5 — *"a contribution is a contribution whether confirmed manually or by webhook; only the `verification_source` differs"*. That sentence was written about Stitch and describes what M5-03 builds, exactly. The design was right about the seam even where it was wrong about the provider.

---

*Verified against Paystack developer documentation, the Paystack South Africa Merchant Services Agreement, Paystack ZA pricing and Paystack support articles as at 29 August 2026, and against an archived copy of the Subaccount API reference from 17 October 2025. Vendor APIs, terms and pricing change; re-verify before implementation. No legal, financial or tax advice.*
