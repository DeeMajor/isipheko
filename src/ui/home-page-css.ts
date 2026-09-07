/**
 * The front page's own styles, appended after `PUBLIC_PAGE_CSS` in the same
 * inline `<style>` — same shape as every other route-handler page, and a
 * separate string so these bytes ride only on `/` and the 404, never on the
 * event page's budget.
 *
 * Everything here is paper, ink and the rule — the page belongs to no ceremony
 * and declares no accent, so the two places an accent could apply use the
 * `var(--accent, #16233d)` fallback and render indigo (rule 2).
 */
export const HOME_PAGE_CSS = String.raw`
/* The wordmark bar every reference screen opens with. The one piece of brand
   on a page that otherwise belongs to nobody. */
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 20px;
  border-bottom: 1px solid var(--rule);
}

.wordmark {
  font-size: 13px;
  font-weight: var(--weight-bold);
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--ink);
}

/* The ink plate the front door opens on: paper type reversed out of solid
   ink, like the cover of the incwadi. Literal --ink and never an accent —
   the page belongs to no ceremony (rule 2's spirit, one shade deeper). The
   quieter voices are paper at reduced opacity rather than invented greys, so
   the palette stays the six tokens and nothing else. */
.plate {
  background: var(--ink);
  color: var(--paper);
  padding-bottom: 34px;
}

.plate .topbar {
  border-bottom: 0;
  padding: 16px 20px;
}

.plate .wordmark {
  color: var(--paper);
}

.plateHeader {
  padding: 38px 20px 0;
}

.plateKicker {
  margin: 0 0 14px;
  font-size: 13px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  font-weight: 600;
  color: var(--paper);
  opacity: 0.72;
}

.plateTitle {
  margin: 0;
  font-size: clamp(34px, 10.8vw, 42px);
  line-height: 1.05;
  font-weight: var(--weight-heavy);
  letter-spacing: -0.035em;
  color: var(--paper-raised);
  text-wrap: balance;
}

.plateIntro {
  margin: 16px 0 0;
  font-size: 16px;
  line-height: 1.6;
  color: var(--paper);
  opacity: 0.85;
  text-wrap: pretty;
}

.plateCord {
  margin: 28px 20px 0;
  color: var(--paper);
}

.plateCord svg {
  display: block;
  width: 100%;
  height: auto;
}

/* Raised cards, 12px like every card in the product. The two "what it is"
   points and the two ways to start all sit in these — form the event page's
   needs cards established. */
.cards {
  list-style: none;
  margin: 16px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.card {
  border: 1px solid var(--rule);
  border-radius: var(--radius-card);
  background: var(--paper-raised);
  padding: 18px 16px;
}

.cardHeading {
  margin: 0;
  font-size: 17px;
  font-weight: var(--weight-bold);
  letter-spacing: -0.015em;
  color: var(--ink);
}

.cardBody {
  margin: 8px 0 0;
  font-size: var(--text-body);
  line-height: 1.55;
  color: var(--ink-soft);
  text-wrap: pretty;
}

/* The bead glyphs above a card's heading. Decorative and aria-hidden — the
   sentence below says the same thing in words. Ink, not accent: the beads on
   a real strand take the ceremony's colour, and this page has no ceremony. */
.cardGlyph {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  color: var(--ink);
}

.cardGlyph svg {
  display: block;
}

/* The folded explanation cards — native <details>, no script. The card's own
   padding moves onto the summary and body so the whole collapsed face is the
   tap target. The marker is drawn by CSS (+ / −) rather than the browser's
   triangle, right-aligned where a thumb expects it. */
.fold {
  padding: 0;
}

.foldSummary {
  position: relative;
  display: block;
  padding: 18px 44px 18px 16px;
  cursor: pointer;
  list-style: none;
}

.foldSummary::-webkit-details-marker {
  display: none;
}

.foldSummary::after {
  content: '+';
  position: absolute;
  top: 50%;
  right: 16px;
  transform: translateY(-50%);
  font-size: 22px;
  font-weight: 400;
  line-height: 1;
  color: var(--ink-soft);
}

.fold[open] .foldSummary::after {
  content: '−';
}

.foldSummary:focus-visible {
  outline: 2px solid var(--accent, #16233d);
  outline-offset: 2px;
  border-radius: var(--radius-card);
}

.foldBody {
  margin: 0;
  padding: 0 16px 18px;
}

/* The sentence under the two start cards saying both begin with a phone
   number and a code — metadata-sized, like .claimHelp, with room above. */
.startNote {
  margin: 12px 0 0;
  font-size: var(--text-metadata);
  line-height: 1.5;
  color: var(--ink-soft);
}

/* Anchors styled as buttons inside a card. The shared button rules set
   width: 100% on what is an inline element here, which the browser ignores —
   flex makes the hit target the full card width it was always meant to be. */
.card .buttonPrimary,
.card .buttonSecondary {
  display: flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  margin-top: 14px;
  text-align: center;
  text-decoration: none;
}
`
