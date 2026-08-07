# Isipheko — Phase 1.5: Proposed Solutions

**Companion to:** Phase 1 Research & Discovery
**Status:** Recommendations for decision. Each item states the problem, the options, and a recommended choice with rationale.

---

## 1. The Payments Problem — Solved with a Three-Tier Ladder

**Problem:** We cannot hold funds without becoming a TPPP. But most marketplace split-payment products assume the beneficiary is a registered business, and our beneficiary is Nomsa's uncle organising a funeral.

The solution is to stop treating this as one architecture and build it as **three modes that share one codebase**, shipping in order of regulatory risk.

### Mode A — Ledger-Only ("Direct Pay")

**We never touch, route, or instruct money at all.**

The organiser enters their own PayShap ShapID or bank details. Contributors see a page with the organiser's verified identity, the event, the needs list, and a "Pay via PayShap" instruction with a copyable reference code. They pay directly, bank to bank. They then tap **"I've paid"** and upload or paste their proof. The organiser confirms receipt with one tap, and the contribution goes onto the public ledger.

- **Regulatory load:** effectively nil. We are a notice-board and a ledger. No funds, no instruction, no TPPP question.
- **What we still deliver:** the event page, the QR code, the WhatsApp share, the needs list, the in-kind pledges, the ledger, the album, the reminders, the multi-approver visibility.
- **What we lose:** payment conversion (manual step), and no card acceptance.
- **Why it's not a compromise:** this is *already how families do it* — a bank number in a WhatsApp group and a screenshot back. We're not asking anyone to change behaviour, we're removing the chaos around it. And because PayShap clears in under ten seconds with instant notification to both sides, the confirmation loop is fast enough to feel live.

**Ship this first.** It gets a real product into real hands while the legal and PSP questions are still open, and every line of it survives into Modes B and C.

### Mode B — Hosted Checkout via Licensed PSP (the target state)

The PSP is the licensed party. Funds move payer → PSP's designated account → organiser's verified bank account. We hold nothing and instruct payouts through the PSP's API. Our fee is taken as a split at settlement, never as a deduction from money in our custody.

This is the same shape BackaBuddy operates in — a non-bank platform serving individual campaigners, with gateway partners doing the regulated work. The pattern is proven locally, which materially de-risks the legal question.

**The individual-beneficiary blocker and how to get past it, in order of preference:**

1. **Ask for individual onboarding explicitly.** Yoco and several SA acquirers onboard sole proprietors and individuals with an ID and a bank account. Frame the request to Stitch and Paystack as *disbursement to a KYC-verified natural person*, not sub-merchant creation. Different product, different answer.
2. **Use a payouts/disbursement API rather than a marketplace-split product.** Splits assume merchants; payout APIs assume beneficiaries. Stitch offers pay-ins and payouts on one platform — the payout leg is the one we need, and it is less merchant-shaped.
3. **Sponsor through a registered TPPP.** Rather than becoming one, contract with an existing registered BSP who collects on behalf of organisers under their licence. Slower and thinner margin, but it works and requires no licence of our own.
4. **Escalate the organiser.** Where an organiser is a church, burial society, stokvel or funeral parlour, they *are* a registerable entity. Offer a business-verified tier that unlocks card acceptance and faster settlement. This turns the constraint into a product segment.

### Mode C — Registered TPPP (only if the numbers justify it)

Sponsoring bank, PASA registration, readiness for SARB's incoming authorisation regime, AML and governance frameworks. Buys us wallets, holds, conditional release and refunds. **Do not attempt before we have volume that pays for the compliance function.** Revisit at Phase 4.

### Payment method priority (Mode B)

Ordered by what the evidence says about this market and this basket size:

1. **PayShap** — 80% of its ~45m monthly transactions are under R500, which is precisely our contribution size. Rail and use case are the same shape.
2. **Capitec Pay** — around 40% of payment value on Stitch's platform. Capitec is the largest retail bank by customer base. Omitting it is not an option.
3. **Instant EFT / pay-by-bank**
4. **Card + Apple Pay / Google Pay** — wallets remove typing on mobile, which is where our traffic is.

**On the ShapID friction:** registration is required before a first mobile-number payment. Handle it as a one-time, well-explained interstitial with a per-bank "how to switch on PayShap" guide, and always keep a non-PayShap option one tap away. Never let it become a dead end.

---

## 2. In-Kind Contribution — The Needs Board

**Problem:** Isipheko is originally food and provisions. Money-only solves half the custom.

**Solution:** The organiser builds a **needs list**; contributors claim from it. Three contribution types share one ledger:

| Type | Flow | Ledger entry |
|---|---|---|
| **Cash** | Pays via any rail | R500 |
| **In-kind claim** | Claims "2 cases of cooldrink" — brings it themselves | 2 cases of cooldrink ✓ delivered |
| **Cash toward an item** | Pays R400 toward the R1,200 tent | R400 of R1,200 — tent 33% |

**Design rules that make this work:**

- **Claiming is reserving.** The moment someone claims the chairs, the chairs show as claimed. This is the single feature that prevents the classic failure — four cakes and no chairs.
- **The organiser confirms delivery**, which closes the loop and creates the trust record. Unconfirmed claims expire and return to the board automatically as the event date approaches.
- **Quantity-aware items.** "10kg meat" can be split five ways by five people bringing 2kg each.
- **Templates by event archetype.** A funeral needs list pre-populates with the things funerals actually need — catering volume, tent, chairs, transport, grocery staples. This is where we demonstrate that we understand the ceremony, and it removes the blank-page problem for a grieving organiser.
- **Anyone can suggest an item** to the organiser for approval — aunties know what's missing better than the app does.

This is the feature that makes us structurally different from every crowdfunding platform in the market, and it costs nothing regulatory because in-kind pledges never involve payments.

---

## 3. Trust Architecture — Because We Look Exactly Like a Scam

**Problem:** A WhatsApp link asking for money during an emotional moment, in a market where SABRIC reports R3.9bn in 2025 banking fraud losses and 65.3% of incidents run on social engineering rather than technical compromise.

We cannot educate our way out of this with a footer. It has to be structural.

**The seven mechanisms:**

1. **Verified organiser, displayed prominently.** Selfie liveness plus Home Affairs ID check — the same pattern FNB now uses for digital stokvel onboarding. The event page shows *"Organiser: S. Mthembu — ID verified 12 July"* above the fold. Verification before first payout is non-negotiable; verification before *publishing* is better where the flow allows.

2. **Family witnesses (multi-approver).** Borrowed from M-Changa's treasurer model, which directly answers the documented SA fear of the treasurer absconding. The organiser nominates 1–3 witnesses at creation. Witnesses appear publicly on the event page, and payouts above a threshold require a second approval. **Reframe it in the copy as honour, not suspicion** — "abakhaphi" / those who stand with you — because being asked to witness is a compliment, not an audit.

3. **A ledger nobody can quietly edit.** Every contribution and every payout is publicly visible with a timestamp. Amounts can be hidden by the contributor; the *fact* of the entry cannot. Withdrawals show as ledger lines, so money in and money out are equally visible.

4. **72-hour hold before withdrawal**, as memorable.me does, giving a dispute window. Show it plainly rather than hiding it — a visible hold reads as safety, not as a delay.

5. **One canonical link shape**, taught relentlessly: `isipheko.co.za/e/…`. Buy the obvious typo-squats. Consistency is an anti-phishing control, and a public that recognises the shape of our link is our best defence.

6. **A "Is this real?" panel on every event page** — a permanent, plain-language block: what we will never ask for, how to verify the organiser, how to report. Turn our biggest liability into a visible signal of seriousness.

7. **We never send OTPs, PINs, or payment requests by SMS or WhatsApp**, stated in-product and in every outbound message. Outbound comms should be deliberately boring and never contain a payment link where an attacker could imitate the pattern.

**Plus one operational commitment:** respond to every fraud report, visibly. The research shows 57% of South Africans who reported scams heard nothing back, which is precisely why trust is so low. A platform that actually answers stands out.

---

## 4. Revenue — We Cannot Win on Fees, So Don't Fight There

**Problem:** BackaBuddy is at 0% platform fee with a voluntary tip. memorable.me is the same. That is now the category standard.

**Solution: match the standard on the core loop, and monetise the ceremony around it.**

- **Core contribution flow: 0% mandatory, voluntary tip at withdrawal.** Present three options as memorable.me does; the ask lands better when the money is already collected and the organiser is relieved rather than anxious. Expect low take-up in a price-sensitive market — do not build the model on it.
- **Contributor-side tip.** Optional "add R10 to keep Isipheko free" at checkout. Small amounts, high volume, and it lands on the party who is feeling generous rather than the party who is under financial pressure.
- **The printed album.** memorable.me gives it free; we charge for it. A bound book of every message, photo and contribution — the modern *incwadi* of who stood with you. This has real margin, real emotional pull, and for weddings and funerals it is a keepsake families already pay for.
- **Printed invitations with the QR built in.** Physical invitation cards remain a live artefact in SA ceremony culture. Selling the card with the contribution QR already on it is a natural, high-intent product.
- **Vendor marketplace (Phase 3+).** Caterers, tent and chair hire, tombstone makers, funeral parlours, photographers. The needs board tells us exactly what each event requires — that is unusually clean lead data. Commission on referred bookings.
- **Verified organisation tier.** Churches, burial societies, stokvels and parlours running many events, paying a small monthly fee for multi-event dashboards, recurring collections and reporting.

**The order matters:** free where families are stressed, paid where they are celebrating or commemorating.

---

## 5. Joy and Grief in One Product — Event Archetypes

**Problem:** A progress bar racing to a target is delightful at a wedding and grotesque at a funeral.

**Solution: make event archetype a first-class concept in the data model**, not a theme picker. Choosing the archetype at creation sets a coherent bundle:

- Colour palette and typography weight
- Whether a monetary target is shown at all, or shown as a quiet total
- Verb choice throughout — "celebrate / contribute" vs "support / stand with"
- Default privacy posture
- Needs-list template
- Whether animation, confetti and sound are present (they are not, for bereavement)
- Notification tone and timing

**Initial archetypes:**

| Group | Events | Register |
|---|---|---|
| **Union** | Umshado, umembeso, umbondo, lobola support, engagement | Warm, celebratory, target visible |
| **Bereavement** | Umngcwabo, memorial, isipheko in the mourning sense | Restrained, no target, no confetti, softer defaults |
| **Remembrance** | Umbuyiso, tombstone unveiling | Dignified, quietly celebratory |
| **Arrival** | Imbeleko, baby welcoming, baby shower | Gentle, joyful |
| **Achievement** | Graduation, matric dance, 21st, farewell, retirement | Bright, energetic |
| **Gathering** | Itiye, church umsebenzi, community fundraiser | Neutral, practical |

**A hard rule for the bereavement group:** no progress bars, no percentages, no countdown timers, no celebratory language, no gamification of any kind. The design system should make it impossible to accidentally render these on a funeral page.

---

## 6. Privacy Defaults — Inverted, With One Exception

**Problem:** memorable.me defaults toward hiding. African giving evidence says contributors want social credit and transparency generates trust.

**Solution:**

- **Default across most archetypes: name and amount public.** This mirrors the physical reality where contributions are announced and recorded in a book. The ledger *is* that book.
- **"Give quietly" is one tap** — name shown, amount hidden. Keep the *fact* of giving visible even when the amount isn't, because that preserves the social record while protecting people who can only afford a little.
- **Fully anonymous is available but not prominent.**
- **Bereavement archetype defaults to amounts hidden**, names visible. Grief context plus POPIA's treatment of religion-adjacent data both point this way, and a funeral contribution list with amounts attached invites comparison at the worst possible moment.
- **The organiser always sees everything.** They need the true record to reciprocate later, which is the whole point of the custom.
- **Event pages are unlisted by default** — reachable by link, not indexed, not searchable. A death in the family is not something to be found on Google.

---

## 7. POPIA Compliance — Concrete Actions

- Register an **Information Officer** with the Information Regulator before launch. Free, online, ~20 minutes. Defaults to the CEO unless formally designated.
- Publish a **PAIA manual** — separate from the privacy policy, and commonly forgotten.
- **Host in South Africa.** Section 72 restricts cross-border transfer, and choosing local hosting sidesteps an entire compliance argument. This constrains vendor choice, so decide it now rather than migrating later.
- **Cookie consent** with opt-in for anything beyond strictly necessary, including analytics.
- **Data minimisation as a design rule:** contributors need no account, so collect a name, a payment reference, and nothing else. Every field we don't collect is a field we can't leak.
- **Breach runbook** targeting notification within 72 hours as best practice, with justification recorded for any delay.
- **Retention policy** — events archive and personal data ages out on a defined schedule.

---

## 8. Delivery — Lightweight, WhatsApp-Native

**Problem:** High data costs are a documented structural barrier, and every kilobyte is friction between an aunt and a contribution.

**Solutions:**

- **PWA, not a native app.** No app-store install between a WhatsApp link and a payment. Installable for organisers who want it.
- **Aggressive performance budget** — target a contribution page under 150KB on first load, server-rendered, images lazy and compressed, no heavy framework on the contributor path. Test on a throttled 3G profile as a build gate, not an afterthought.
- **The WhatsApp link preview is the product's front door.** It gets more views than the page itself. Invest properly in the OG image: event name, organiser name, verified badge, archetype-appropriate design. Generate it server-side per event.
- **Share flow is WhatsApp-first**, with the message pre-written in the organiser's chosen language, and a voice-note prompt — voice notes are how this market actually communicates.
- **QR code for print** on the physical invitation card and for display at the venue, as memorable.me does. This is the offline-to-online bridge and it fits existing ceremony behaviour exactly.
- **USSD is deferred, not designed out.** M-Changa proves the value (`*483*57#`) but it needs aggregator relationships and per-session costs. Keep the contribution model channel-agnostic so it can be added at Phase 3.

**Language:** launch English and isiZulu. Add isiXhosa, Sesotho and Afrikaans in that order. Build i18n in from commit one — retrofitting it is expensive, and the emotional moments in this product do not happen in a second language.

---

## 9. Naming — Keep It, But Hedge Deliberately

**Problem:** *Isipheko* is strongly KZN/Zulu, carries a food connotation, and won't be recognised in Sotho-Tswana, Tsonga, Venda or Afrikaans households. Gauteng — our biggest likely market — is the most linguistically diverse province.

**Solution:**

- **Keep the name.** Nguni languages are over 40% of home-language speakers combined, the word is precise and warm, and a culturally-specific name is exactly the kind of asset a generic competitor cannot copy.
- **Always pair it with a plain-language descriptor** in the logo lockup and every link preview: *Isipheko — contribute to the moments that matter*. This removes the recognition problem without diluting the name.
- **Lean into the food meaning rather than apologising for it.** The needs board makes the cooking sense *correct*. "Isipheko" meaning provisions-for-the-feast is the product, literally.
- **Test before committing** — 8–12 interviews split Gauteng/KZN, including the name specifically. If non-Nguni speakers find it alienating rather than merely unfamiliar, the descriptor does more work or we reconsider.
- **Register defensively now:** CIPC name, `isipheko.co.za`, `.africa`, `.com`, social handles, and trademark classes 36 (financial) and 42 (software). Do this before we talk about it publicly.

---

## 10. Recommended Build Sequence

**Phase A — Ledger-Only (ships without any payments licence question)**
Event creation with archetypes, verified organiser identity, needs board with in-kind claiming, direct-pay instructions with reference codes, contributor self-report and organiser confirmation, public ledger, WhatsApp share and QR, album view. *This is a complete, usable product.*

**Phase B — Hosted Payments**
PSP integration, PayShap and Capitec Pay first, then instant EFT and cards. Automated ledger entries, 72-hour hold, multi-approver payouts, voluntary tip at withdrawal. Gated on the legal opinion and the individual-payout answer.

**Phase C — Monetisation and Depth**
Printed album, printed invitations, verified organisation tier, additional languages, vendor marketplace pilot.

**Phase D — Reach**
USSD channel, recurring collections for burial societies and stokvel-adjacent groups, TPPP evaluation if volume justifies it.

The important property of this sequence: **Phase A ships real value while the two gating questions are still open**, and nothing built in Phase A is thrown away.

---

## 11. What Still Has to Be Answered Before Phase 2

These have solutions proposed above but need external confirmation:

1. **Payments attorney** — does Mode A avoid regulation entirely, and does Mode B avoid TPPP registration for our exact flow?
2. **Stitch and Paystack** — will they disburse to KYC-verified individuals, and at what per-transaction cost on a R50–R500 basket? Get quotes on our real basket, not the R600 industry model.
3. **Identity verification vendor** — who does Home Affairs-linked liveness checks, at what per-check price? This determines whether verify-before-publish is affordable or has to be verify-before-payout.
4. **CIPC, domain and trademark** availability on Isipheko.
5. **8–12 user interviews** testing the name, the public-ledger assumption, and whether the needs board is genuinely wanted or is a founder's idea that dies on contact.

*No legal, financial or tax advice. Items in §11 require professional verification before build.*
