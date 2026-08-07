# Isipheko — Phase 1: Research & Discovery

**Status:** Research complete, findings only. No product decisions locked.
**Date:** 31 July 2026
**Purpose:** Establish a verified evidence base before we scope the system. Everything below is sourced. Where something could not be verified, it is listed in §12 (Open Questions) rather than assumed.

---

## 1. Executive Summary

The concept is sound, the cultural anchor is real, and the timing is good. But three findings should reshape the product before a single line of code is written.

**Finding 1 — Isipheko is not primarily about money.** The word derives from *ukupheka* (to cook). Traditionally it means arriving at someone's event with food, drink, or provisions to help them carry the cost of hosting. Money is a modern substitute, not the original form. A platform that only does money is solving half the custom. **Recommendation: build in-kind pledging as a first-class feature, not a v2 nice-to-have.** This is our single biggest differentiator from memorable.me, BackaBuddy, and GoFundMe — none of them do it.

**Finding 2 — We should not hold the money.** Under SARB Directive 1 of 2007, accepting funds for on-payment to a third party makes you a Third Party Payment Provider, requiring registration via a sponsoring bank. A new SARB draft Directive moves this to direct activity-based authorisation with far heavier compliance. **Recommendation: never touch the funds. Use a licensed PSP's sub-account/split-payment rails so money flows payer → PSP → organiser, with Isipheko as software only.**

**Finding 3 — Public recognition is the feature, not privacy.** memorable.me lets contributors hide their amount. The African precedent (M-Changa in Kenya) shows the opposite dynamic: contributors *want* visible social credit, and organisers need a verifiable public record. In a culture where "who brought what" is remembered and reciprocated, the ledger is the product.

The commercial risk is real: BackaBuddy already runs a 0%-fee, voluntary-tip model in South Africa at scale. We cannot win on price. We win on being *built for izimicimbi* — the ceremonies — rather than being a charity tool bent to fit them.

---

## 2. The Source Model: memorable.me Deconstructed

Reviewed directly from the live product.

**What it is:** A free online "money pot" for celebratory and supportive events — group gifts, birthdays, weddings, farewells, fundraisers.

**Mechanics:**
- Organiser creates a pot in ~2 minutes: goal, countdown, description.
- Platform generates a shareable link and a QR code, explicitly designed for printing on posters and invitations or displaying on-screen at the venue.
- Contributors need **no account**. They pay by card from any country.
- Contributor can attach a message and photo, and independently choose whether the **amount** and the **message** are visible to everyone or only the organiser.
- Every contribution feeds a **message-and-photo album**, printable for free to hand over in person, or shareable as a web "Story".
- Withdrawals go to a bank account by transfer, multiple withdrawals allowed, no need to wait for the pot to close.

**Business model:** Zero mandatory commission. At withdrawal the organiser chooses a voluntary contribution (the UI presents 4% / 2% / 0%). They position competitors as taking ~6% on average.

**Trust architecture:**
- Payments and identity verification handled by Stripe.
- Identity verification required before withdrawal.
- 3D Secure on payments, encryption at rest.
- Funds held in a dedicated deposit account, stated as belonging 100% to the organiser, with the platform earning nothing on the float.
- Contributions held 72h before becoming withdrawable; withdrawal itself takes 48–72h.
- Verification codes sent to the organiser for sensitive actions.

**Scale (self-reported):** 1k+ pots, 8k+ contributions, 4.8 rating from 100+ reviews. Founded 2026 by the founder of ungrandjour.com, a wedding-pot specialist. **This is a young, small product.** We are not chasing a giant.

**What transfers to SA:** The QR-at-the-venue mechanic, the no-account contribution flow, the album as emotional payoff, the voluntary-tip model, the 72h hold.

**What does not transfer:** Card-only payment (wrong for SA), the amount-hiding default (culturally backwards here), Stripe as processor, and the assumption that a "pot" is the whole product.

---

## 3. Isipheko: The Cultural Ground Truth

### 3.1 Definition

A Zulu-language source defines it directly: isipheko is the custom of helping those who are hosting an *umcimbi* (event/ceremony). The source gives examples — a wedding, a death or illness, or a tea — and describes invited people bringing food gifts such as cakes, drinks, and fruit, or whatever else they judge important, so that the host's event succeeds. Crucially, it states isipheko is **not compulsory**, but is a good practice showing empathy and mutual support.

A widely-shared KZN description frames it as the way of showing sympathy and *ubuntu* to a mourning family with whatever one can afford — noting that even a bucket of scones is deeply appreciated.

The term also appears in formal cultural commentary: a Zulu cultural expert distinguished *isipheko* (a donation) from a structured lobola contribution when clarifying the status of cattle given to the Zulu royal household — confirming it is a live, precise term for a gift/donation toward an occasion, not slang.

### 3.2 The four things this tells us

1. **It is host-directed, not cause-directed.** The money helps the *organiser* discharge the burden of hosting. This is different from charity. Framing matters enormously.
2. **It is voluntary and unpriced.** No fixed amount. "Whatever you can afford." A platform that sets suggested tiers too rigidly will feel wrong.
3. **It is originally in-kind.** Food, drink, provisions. The etymology (*ukupheka*, to cook) confirms this.
4. **It spans joy and grief.** The same word covers a wedding, a tea, and a death. The product must handle a 21st birthday and a funeral with equal grace — which is a serious tone-and-design constraint (see §9.4).

### 3.3 Naming risk — flagged, not resolved

Two issues we must confirm before committing:

- **Semantic ambiguity.** A multilingual dictionary indexes *isipheko* under Food & Drink. The cooking sense is live. This may be an asset (it's warm, it evokes hospitality) or a liability (people expect a catering app). Needs testing with real speakers.
- **Regional specificity.** The evidence base for *isipheko* is strongly KZN/Zulu. It is not a pan-South-African word. Sotho-Tswana, Tsonga, Venda and Afrikaans speakers will not recognise it. In Gauteng — our largest likely market, and the most linguistically mixed province — this is a live question, not a theoretical one.

This isn't a reason to abandon the name. Nguni languages are the largest bloc (isiZulu 24.4% and isiXhosa 16.3% of home-language speakers per Census 2022 — over 40% combined), and a strong culturally-specific name can travel. But we must test it, and we must not assume it reads as intended outside KZN.

---

## 4. Market Context

### 4.1 The events themselves are expensive — and already collectively funded

- **Funerals:** A basic dignified municipal-cemetery burial runs roughly R10,000–R15,000; a full-service funeral with a premium home, private plot, catering for 200 and a granite tombstone can exceed R80,000.
- **Tombstone unveilings:** Typically held around 12 months after the funeral. Cost ranges from about R5,000 upward, and can run into hundreds of thousands once celebration, transport and rentals are included.
- **Lobola:** Commonly R25,000 to well over R100,000, varying with the bride's education and family expectations. A frequently cited benchmark is 10 cattle.
- **Weddings:** Cited averages of roughly R70,000–R150,000, *on top of* lobola.
- **Umembeso / umbondo:** Gift-giving ceremonies that follow lobola, each with their own cost.

Critically, the tombstone industry itself documents the existing behaviour: relatives, neighbours, church members and stokvels routinely come together after a loss — one helps with groceries, another with transport, others contribute money toward the tombstone or the unveiling ceremony. **We are not creating a behaviour. We are digitising one that already moves large sums through cash and WhatsApp.**

### 4.2 The collective-money culture is enormous and already formalising

- ~800,000 stokvels in South Africa, ~11 million members (roughly one in four adults), turning over an estimated R50 billion annually.
- FNB alone serves ~110,000 stokvels; inflows from Sept 2020 to Dec 2025 reached R20.6bn, with balances at R4.2bn as of Dec 2025 (up 21% year on year).
- FNB has now fully digitised stokvel account opening — live selfie verification, Home Affairs ID checks, digital constitution acceptance, real-time activation, no branch visit.
- Despite this, cash reportedly remains the preferred mode of operation for most stokvels.

**The strategic read:** the digitisation of communal money in SA is happening *now*, driven by members' own concerns about cash risk — documented incidents of robbery on payout day and treasurers absconding. The trust problem is the wedge. Isipheko is adjacent to stokvels, not competing: stokvels are recurring and closed-membership; isipheko is one-off and open-invitation.

---

## 5. Competitive Landscape

| Player | Model | Fee | Relevance |
|---|---|---|---|
| **BackaBuddy** (SA) | Donation crowdfunding | **0% platform fee**, voluntary tip; gateway fees only | The direct threat. Same fee philosophy as memorable.me, already local, already trusted. >R630m raised since 2015 across 44,000+ campaigns. Explicitly serves funeral costs. |
| **M-Changa** (KE) | Harambee-native fundraising | 4.25% on withdrawal | **The closest cultural analogue.** Web + SMS + USSD (`*483*57#`). Up to 3 treasurers must approve withdrawals. Built explicitly on a communal-giving tradition. |
| **OneKitty** (Africa) | Group collections | — | Group-collection framing, close to our use case |
| **GoFundMe** | Global crowdfunding | — | Brand recognition, no local payment fit |
| **Zenlipa** | Events ticketing + fundraising + church + savings | — | Adjacent bundle worth watching |
| **Farewell** (SA) | Bereavement ecosystem — planning, policy management, digital memorials, glass tombstones with QR memorials | — | Adjacent, SA-specific, potential partner or competitor in the funeral vertical |

**Gap analysis:** Nobody in South Africa is building specifically for *izimicimbi* — the ceremony calendar. BackaBuddy is a cause platform. Farewell is a death platform. Stokvel apps are savings platforms. **The celebration-and-ceremony contribution space is open.**

**The M-Changa lessons we should steal:**
- Multi-treasurer approval on withdrawals. This directly answers the "treasurer ran off with the money" fear that SA stokvel members articulate.
- Transparency as the core trust mechanism.
- Offline channel (USSD/SMS) for participants without reliable data.
- The observation that this giving is explicitly *not anonymous charity* — contributors expect social credit for having given.

---

## 6. Regulatory & Legal Findings

### 6.1 The payments licensing question — most important constraint in this document

Under **SARB Directive 1 of 2007**, a Third Party Payment Provider is an entity that accepts money (or the proceeds of payment instructions) from payers for on-payment to third persons to whom the money is due. Two types exist: Beneficiary Service Providers and Payer Service Providers. A TPPP may hold funds in its own bank account for a limited period, **but must be registered with PASA via a sponsoring bank**. By contrast, a System Operator provides only the technology and never accepts funds into its own account.

**Reform in flight:** SARB has published a draft Directive moving to an *activity-based* framework. Under it, anyone conducting listed payment activities must obtain SARB authorisation — **even if already PASA-registered as a TPPP**. It reportedly also reaches closed-loop systems. Applicants would need to supply company structure, shareholders, key staff, and governance, audit, risk and AML frameworks, with SARB empowered to inspect systems and records. National Payment System reform is expected to open the system to non-bank PSPs.

**Implication:** Two possible postures.

- **Posture A (recommended for MVP): System Operator only.** We never receive funds. A licensed PSP collects from contributors and settles directly to the organiser's verified bank account via a sub-account/split arrangement. Our platform fee is taken as a split, not as a deduction from money we hold. Lowest regulatory burden, fastest to market.
- **Posture B: Become a registered TPPP.** Gives us control over holds, refunds, escrow-like release conditions and a real wallet. Requires a sponsoring bank, PASA registration, and readiness for the incoming SARB authorisation regime. This is a 6–18 month, legally expensive path.

**Get a payments lawyer to confirm Posture A before build.** The draft Directive is a moving target and this document is not legal advice.

### 6.2 POPIA (Protection of Personal Information Act 4 of 2013)

Fully enforceable since 1 July 2021, with the grace period expired 1 July 2022. Enforcement is now routine, including own-initiative inspections.

Requirements that bite for us:
- **Register an Information Officer** with the Information Regulator. For companies this defaults to the CEO/MD unless someone else is formally designated. Registration is free and online.
- **PAIA manual** required for every private body — separate from the privacy policy.
- **Eight conditions for lawful processing:** accountability, processing limitation, purpose specification, further processing limitation, information quality, openness, security safeguards, data subject participation.
- **Breach notification** "as soon as reasonably possible"; no fixed window, but 72h is treated as best practice and delay must be justifiable.
- **Cross-border transfers** restricted under s72 — adequacy, consent, or contractual necessity. **This directly constrains our hosting and vendor choices.**
- **Cookie consent** required where cookies collect personal information, including analytics.
- **Penalties:** administrative fines up to R10 million; certain offences carry up to 10 years' imprisonment. Fines already issued (R5m against government departments, R100,000 against a private entity).

**Special sensitivity for us:** funeral contributions reveal a death, a family relationship, and often religion. Under POPIA, religious belief is special personal information. A public contribution ledger on a funeral event needs careful defaults.

### 6.3 Tax

**Donations tax changed this year — do not use older figures.** Per SARS Budget 2026 guidance, the natural-person annual exemption rose to **R150,000** (from R100,000), and the non-natural-person casual-gifts exemption to **R20,000** (from R10,000). Rates: 20% up to R30m, 25% above. Liability sits with the **donor**, not the recipient. The donor files an IT144 and pays via eFiling by the end of the month following the donation.

Also relevant: a bona fide contribution toward the maintenance of a person is exempt, limited to what SARS considers reasonable.

**Product implication:** Individual isipheko contributions will almost never approach R150,000, so this is low-risk in practice. But we should surface a plain-language note and never present ourselves as giving tax advice. Organisers receiving large totals will ask — we need a prepared, correct, non-advisory answer.

### 6.4 Other

- **FICA / KYC** applies at the PSP layer for organiser payouts. Whoever we partner with will impose identity verification before settlement — this is a feature, not a bug (see §10).
- **CIPC company registration** and **trademark search** on "Isipheko" — not yet done, flagged in §12.

---

## 7. Payments Architecture Findings

### 7.1 There is no single dominant payment method in South Africa

Per Stitch's 2026 Consumer Payments Report:
- **Capitec Pay** accounts for around 40% of total payment value across their platform.
- **Digital wallets** (led by Apple Pay) have surged.
- **New-method adoption in the past 12 months:** one-click wallets 58%, BNPL 39%, Capitec Pay 37%, PayShap 35%.
- **PayShap checkout preference:** 3rd for online purchases (8.5%), 4th for groceries (6.6%).

**Design implication: we must be multi-rail from day one.** A card-only checkout — the memorable.me approach — would fail here.

### 7.2 PayShap is the strategic rail for this use case

- Clears in **under 10 seconds, 24/7**, including weekends and public holidays, with instant notification to both parties.
- Supported across Absa, Capitec, FNB, Nedbank, Standard Bank, TymeBank, African Bank, Discovery, Investec and more.
- **~45 million transactions per month by late 2025, 80% of which were under R500** — an eightfold surge during 2025 from ~6 million/month.
- Over 900 million cumulative transactions; average ticket size has fallen to about R498.
- SARB acquired a 50% stake in PayInc (which governs PayShap) in October 2025.
- **PayShap Request** has opened a merchant-acceptance channel beyond the original P2P focus.

**Why this matters so much:** 80% of PayShap transactions are under R500. That is *exactly* the isipheko contribution size. The rail and the use case are the same shape.

**Known frictions:** ShapID registration is required before a first mobile-number payment — a real onboarding barrier. BankservAfrica has acknowledged that transaction fees and inconsistent UX across banking apps have held back adoption. Some banks charge for PayShap, others treat it as free infrastructure.

Note also: RTC / "instant EFT" is *not* actually instant — in practice around 30 minutes, sometimes an hour, and it costs more.

### 7.3 Provider shortlist

Based on architecture fit, not price:

- **Stitch** — bank-to-bank and open banking, explicitly built for fintechs and platforms, certified Capitec Pay provider, pay-ins *and* payouts on one platform. Also has an Express tier for faster onboarding. **Best fit for Posture A.**
- **Paystack** — has a mature, well-documented **subaccount + split payment** model: create a subaccount per beneficiary tied to their bank account, set a percentage split, and the platform's cut is retained automatically at settlement. Bank details can be validated via a resolve-account endpoint. This is architecturally close to exactly what we need.
- **Peach Payments** — established, strong card performance, good plug-in ecosystem; noted as less suited to complex payout flows.
- **Ozow** — cheapest in a modelled comparison at R200k/month volume; instant-EFT focused.
- **Yoco** — strong for SMEs and in-person; not designed for complex online payout flows.

**Indicative cost modelling** (R200,000/month, R600 average order, 333 transactions, 70/30 card/EFT split): Ozow ~R4,890/month, Yoco ~R5,330, Stitch Express ~R5,374, Peach ~R5,530. Our average transaction will be far smaller than R600, which changes the maths — per-transaction fixed fees will hurt disproportionately. **We must model our own basket before choosing.**

---

## 8. The User: Devices, Data, and Where They Actually Are

- **51.7 million internet users** in South Africa as of Oct 2025 — **79.6% penetration**, up from 74.7% the prior year.
- **127 million cellular connections** (196% of population — multi-SIM is normal).
- ~97.5% of mobile connections are broadband-enabled (3G/4G/5G).
- **29.1 million social media identities** — only 44.9% of population, notably lower than internet penetration.
- **WhatsApp is used by ~96% of South African internet users** and is the dominant platform. Voice notes are central to African usage patterns — over 7 billion sent daily globally.
- High data costs remain a documented structural constraint.

**Language (Census 2022, home language):** isiZulu 24.4%, isiXhosa 16.3%, Afrikaans 10.6%, Sepedi 10.0%, English 8.7%, Setswana 8.3%, Sesotho 7.8%, Xitsonga 4.7%, siSwati 2.8%, Tshivenda 2.5%, isiNdebele 1.7%. SASL became the 12th official language in July 2023.

**Provincial:** Gauteng ~15m and KwaZulu-Natal ~12.4m are the largest provinces. KZN is over 80% isiZulu-speaking; Gauteng is the most linguistically diverse province with no dominant language.

**Design consequences:**
1. **WhatsApp is the distribution channel.** Not email, not app stores. The share flow must be WhatsApp-first, and the artefact shared must render beautifully as a WhatsApp link preview.
2. **Data cost is a design constraint.** Every kilobyte is a barrier to a contribution. This argues hard for a lightweight PWA over a native app.
3. **Social media penetration (44.9%) is well below internet penetration (79.6%).** Many users are on WhatsApp and little else. Do not build a social-feed product.
4. **English-first with isiZulu at launch** is defensible, but English is only 8.7% as a home language. It is the business lingua franca, but emotional moments do not happen in a second language.

---

## 9. UX Findings & Implications

### 9.1 The core flow, adapted

memorable.me's three steps (Create & Share → Collect → Give) are sound. The SA adaptation:

**Create** — organiser sets up an *umcimbi*, not a "campaign". Event type drives everything downstream: tone, imagery, default privacy, suggested contribution structure.

**Share** — WhatsApp-first. QR code for printing on the physical invitation card, which is still a real and important artefact in SA ceremony culture, and for display at the venue. The link preview is the product's front door.

**Contribute** — no account required. Multi-rail: PayShap, Capitec Pay, card, wallet, instant EFT. **Plus: pledge in kind.**

**Acknowledge** — the album/ledger. This is the emotional payoff and the trust artefact simultaneously.

### 9.2 The in-kind pledge — our defining feature

Because isipheko is originally food and provisions, the platform should let a contributor choose:

- Give money, **or**
- Pledge an item — a case of drinks, a cake, 10kg of meat, chairs, a tent, transport, a cow — **or**
- Pay money *toward* a specific item on the organiser's list.

This produces a live "what's still needed" board that the organiser controls. It maps precisely onto how families actually coordinate an umcimbi over WhatsApp today — and it's an answer to a genuine coordination problem (three people bring cake, nobody brings chairs).

No competitor identified does this. It is the strongest defensible differentiator we have.

### 9.3 Visibility defaults must be inverted from memorable.me

memorable.me defaults toward contributor-controlled hiding. The evidence from Kenya's harambee tradition is that contributors expect and want public social credit, and that transparency is what generates trust.

**Proposed default: contributions are publicly listed with name and amount, with an explicit opt-out to "give quietly."** This mirrors the physical reality — at an actual umcimbi, contributions are announced and recorded in a book. The digital ledger *is* the modern version of that book.

**Exception:** funeral events should default to a softer setting. Grief context and POPIA's treatment of religion-adjacent data both argue for care here.

### 9.4 The joy/grief tonal problem

The same product serves a 21st birthday and a funeral. This is a genuine design challenge, not a theme-picker problem. Colour, copy, iconography, animation, notification sound and even the word "goal" must shift by event type. A progress bar racing toward a target is delightful for a wedding gift and grotesque for a funeral.

**Recommendation: event archetypes as a core data model concept**, each carrying its own tonal system:
- *Umshado* (wedding), *umembeso*, *umbondo*, lobola support
- *Umngcwabo* (funeral) and *isipheko* in the bereavement sense
- *Umbuyiso* / unveiling
- *Imbeleko*, baby welcoming, baby shower
- Graduation, matric dance, 21st
- *Itiye* (tea), church and community *umsebenzi*
- Farewell, retirement, send-off

### 9.5 Offline and low-connectivity

M-Changa's USSD channel (`*483*57#`) is instructive. A USSD fallback lets an aunt in a rural area contribute without data. This is likely out of scope for MVP — USSD requires aggregator relationships and per-session costs — but the architecture should not preclude it. **Flag as a Phase 3 candidate.**

---

## 10. Trust & Fraud: The Make-or-Break Layer

The environment is hostile and getting worse:

- Digital banking fraud incidents rose **86% in 2024** vs 2023, with losses up 74% — 97,975 incidents, roughly R1.888 billion gross.
- SABRIC reports banking fraud losses climbed to **R3.9 billion in 2025**, a 23% increase.
- Banking apps were the dominant channel — 65.3% of reported incidents.
- Crucially: incidents involved **criminals exploiting human error through social engineering, not technical breaches of app security.**
- Card-not-present transactions made up 85.6% of gross fraud losses on SA-issued credit cards.
- AI-powered fraud — deepfaked voice notes, cloned WhatsApp accounts, fluent phishing — is erasing the old tells.
- A 2026 survey of SA bank fraud leaders: 75% report increasing attempts, 79% report increasing losses.
- Reporting rates fell to 65.1% in 2024/25, and 57% of those who reported heard nothing back.

**What this means for us, precisely:**

Our product is a link, sent over WhatsApp, asking for money, during an emotionally charged moment. **That is structurally identical to a scam.** We are building the exact artefact that fraudsters are currently using. If we do not solve this deliberately, we will fail — and worse, we could be used as a fraud vector.

**Required trust architecture:**
1. **Verified organiser identity before any payout** — non-negotiable, and *displayed* on the event page. Borrow the FNB pattern: live selfie plus Home Affairs ID verification.
2. **Multi-signatory withdrawals**, M-Changa style — the organiser nominates additional approvers. Directly answers the absconding-treasurer fear.
3. **Public, immutable ledger** — every contribution and every withdrawal visible. Transparency is the trust mechanism.
4. **Hold period before withdrawal** (memorable.me uses 72h) to allow disputes.
5. **A canonical domain and link format** people can be taught to recognise. Consistency is an anti-phishing control.
6. **Explicit "how to check this is real" guidance** on every event page, and public education as a marketing channel.
7. **Never ask for OTPs, PINs or card details in any outbound message**, and say so loudly and repeatedly.

Also relevant: South Africa's exit from the FATF grey list is noted as a turning point, with regulators raising standards. AML expectations at the PSP layer will apply to us via our provider.

---

## 11. Positioning: Where We Win

We cannot beat BackaBuddy on fees — they're at zero. We must win on **fit**.

**Proposed positioning:** *Isipheko is for izimicimbi.* Not a crowdfunding site with a cultural coat of paint, but a system built from the inside of how South African families actually host, contribute, and remember.

The three pillars:
1. **In-kind and cash together** — the only platform that understands isipheko is food *and* money.
2. **The ledger as heirloom** — the album/record isn't a receipt, it's the modern *incwadi* of who stood with you. Printable, keepable, shareable.
3. **Built for the ceremony calendar** — event archetypes that know the difference between umembeso and an unveiling.

On fees, the memorable.me and BackaBuddy model (0% mandatory, voluntary tip at withdrawal) is now effectively the SA market standard for this category. We should assume we must match it, and model the business on gateway margin, premium features (printed albums, physical invitations, vendor marketplace), or organiser-side tooling rather than a take rate.

---

## 12. Open Questions — Things We Have NOT Verified

Listed explicitly so nothing gets assumed into the build.

**Naming & brand**
1. Is "Isipheko" available as a CIPC company name, a `.co.za` domain, and a trademark in the relevant classes? *Not checked.*
2. How does the name test with non-Nguni speakers in Gauteng? *Requires primary research.*
3. Does the food connotation help or hurt? *Requires primary research.*

**Regulatory**
4. Does Posture A (System Operator, never touching funds) definitively avoid TPPP registration for our specific flow? **Requires a payments attorney.**
5. What is the current status and expected commencement of the SARB draft Directive? *Moving target — needs monitoring.*
6. Are there consumer-protection or CPA implications where a contributor pledges toward a goal the organiser doesn't meet?

**Payments**
7. What are the *actual* per-transaction economics at our expected basket size (likely R50–R500, not R600)? Needs direct quotes from Stitch, Paystack, Peach and Ozow.
8. Will any of these providers support our sub-account/split model for **individual** (non-business) beneficiaries? This is the critical technical question — most marketplace splits assume registered merchants, not private individuals. **This could break Posture A entirely.**
9. Can we access PayShap Request as a platform, and on what terms?

**Users**
10. Do organisers actually want a public ledger, or is there shame attached to visible fundraising for a funeral? *Assumption — must be tested.*
11. Will contributors trust a new brand with a payment link given the fraud environment? *Assumption — must be tested.*
12. What is the real willingness to pay a voluntary tip in the SA market?
13. Who is the organiser persona — the 28-year-old daughter in Joburg organising for a rural family, or the elder themselves? This changes the entire UX.

**Product**
14. Does the in-kind pledge feature actually get used, or is it a founder's idea that dies in testing?

---

## 13. Recommended Next Steps

**Immediate (before scoping):**
- Legal consult on Posture A. This is the gating item.
- Direct conversations with Stitch and Paystack on Q8 — individual beneficiary payouts. This is the second gating item.
- CIPC, domain and trademark checks on "Isipheko".

**Primary research (2–3 weeks):**
- 8–12 interviews with people who have organised an umcimbi in the last 18 months, split across Gauteng and KZN, and across joyful and bereavement events.
- Test the name, the public-ledger assumption, and the in-kind concept.
- WhatsApp-based research is worth considering given where these users already are.

**Then Phase 2 (Product Definition):**
- Personas and jobs-to-be-done, grounded in the interviews
- Event archetype model and tonal system
- Full user journeys
- Information architecture and data model
- Feature prioritisation, MVP scope line
- Trust and safety specification
- Brand and design system direction

**Then Phase 3 (Technical Specification):** the document that goes to Claude Code — architecture, stack, schema, API contracts, integration specs, security model, environment and deployment plan, and a task breakdown structured for agentic implementation.

---

## Appendix: Key Source Notes

- memorable.me product detail taken directly from the live site, July 2026.
- Isipheko definition from a Zulu-language cultural blog (zuluring), corroborated by a KZN social-media description and by a Zulu cultural expert's usage in national press coverage of the Zulu royal household.
- Payments data: Stitch 2026 Consumer Payments Report, BankservAfrica/PayInc figures via ClearingPost and Netcash.
- Regulatory: PASA, SARB Directive 1 of 2007, ENSafrica commentary on the draft Directive.
- Tax: SARS Budget 2026 guidance via TaxTim and ElyForma. **Note the R150,000 figure supersedes the R100,000 quoted in most older sources.**
- Demographics: Statistics South Africa Census 2022; DataReportal Digital 2026 South Africa.
- Fraud: SABRIC Annual Crime Statistics; BioCatch 2026 SA banking survey.

*This document contains no legal, financial or tax advice. Items in §12 must be professionally verified before build.*
