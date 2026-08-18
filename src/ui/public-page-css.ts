/**
 * The public event page's styles, as a string.
 *
 * A string rather than a CSS Module because the page is rendered from a route
 * handler, which has no bundler step to run CSS through (docs/decisions.md
 * M1-08). It is inlined into the head alongside the tokens — one round trip
 * rather than two, on a connection where the round trip is the expensive part.
 *
 * Every accent usage is `var(--accent, #16233d)`, and the unit test that scans
 * for a bare `var(--accent)` covers this file too.
 */
export const PUBLIC_PAGE_CSS = String.raw`
.page {
  max-width: 480px;
  margin: 0 auto;
  background: var(--paper);
}

.header {
  padding: 28px 20px 22px;
  border-bottom: 1px solid var(--rule);
}

.kicker {
  margin: 0 0 10px;
  font-size: var(--text-metadata);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ink-soft);
  font-weight: 600;
}

.title {
  margin: 0;
  font-size: 30px;
  line-height: 1.08;
  font-weight: var(--weight-heavy);
  letter-spacing: -0.035em;
  color: var(--ink);
  text-wrap: pretty;
}

.subtitle {
  margin: 6px 0 0;
  font-size: 19px;
  font-weight: 600;
  letter-spacing: -0.015em;
  color: var(--ink);
}

.when {
  margin: 8px 0 0;
  font-size: var(--text-body);
  line-height: 1.5;
  color: var(--ink);
}

.organiser {
  margin: 14px 0 0;
  font-size: var(--text-metadata);
  line-height: 1.5;
  color: var(--ink-soft);
}

/* The report form's reasons (M3-06). Radios, all visible at once, none chosen
   by default — somebody upset should not have to open a menu to find the
   sentence that describes what happened to them. */
.reasons {
  margin: 0;
  padding: 0;
  border: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.reason {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  font-size: var(--text-body);
  line-height: 1.5;
  color: var(--ink);
  cursor: pointer;
}

/* 24px is the smallest a radio can be and still be hit with a thumb, which is
   the only input device most of these people have. */
.reason input {
  inline-size: 24px;
  block-size: 24px;
  margin: 0;
  flex: none;
  accent-color: var(--accent, #16233d);
}

/* The compact "Is this real?" carried through the contribution flow (M3-04).

   Paper and ink, a rule above it, no error colour and no icon — it is a
   permanent part of the page rather than an alarm that has gone off. The full
   panel on the event page is styled the same way and for the same reason. */
.stillReal {
  margin-top: 26px;
  padding: 20px 20px 32px;
  border-top: 1px solid var(--rule);
  background: var(--paper-raised);
}

/* The link to /check, under the instruction to type it (M3-04).

   Its own line and underlined, so it reads as an address rather than as a
   button offering to do the checking for you — the instruction above is the
   protection and this is the convenience. */
.checkLink {
  display: block;
  margin-top: 6px;
  color: var(--ink);
  font-weight: var(--weight-bold);
  text-decoration: underline;
  text-underline-offset: 3px;
}

/* Abakhaphi, beside the organiser (M3-03) — the names of those who agreed to
   stand with the family, and nothing else about them. */
.witnesses {
  margin: 6px 0 0;
  font-size: var(--text-metadata);
  line-height: 1.5;
  color: var(--ink-soft);
}

/* The verified badge (M3-02), above the fold and beside the name it belongs to.
   Ink rather than a colour of its own: there is no "success green" in the
   palette and inventing one for the most consequential line on the page is not
   where a new hue should make its debut (M1-05 §4). */
.verified {
  margin: 6px 0 0;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--text-metadata);
  line-height: 1.5;
  color: var(--ink);
  font-weight: 600;
}

/* Decorative, and hidden from screen readers — the sentence beside it says the
   same thing in words, with the name and the date on it. */
.verifiedTick {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  inline-size: 20px;
  block-size: 20px;
  border-radius: 10px;
  background: var(--accent-strong, #16233d);
  color: var(--paper-raised);
  font-size: 13px;
  line-height: 1;
}

.section {
  padding: 26px 20px 8px;
}

.heading {
  margin: 0;
  font-size: 21px;
  font-weight: var(--weight-heavy);
  letter-spacing: -0.025em;
}

.intro {
  margin: 8px 0 0;
  font-size: var(--text-body);
  line-height: 1.55;
  color: var(--ink-soft);
  text-wrap: pretty;
}

.needs {
  list-style: none;
  margin: 18px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.need {
  border: 1px solid var(--rule);
  border-radius: var(--radius-card);
  background: var(--paper-raised);
  padding: 14px;
}

.needLabel {
  margin: 0;
  font-size: 17px;
  font-weight: var(--weight-bold);
  letter-spacing: -0.015em;
  color: var(--ink);
}

.needNote {
  margin: 7px 0 0;
  font-size: 14px;
  line-height: 1.5;
  color: var(--ink-soft);
}

.needStatus {
  margin: 7px 0 0;
  font-size: var(--text-metadata);
  color: var(--ink-soft);
}

.claimForm {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 12px;
}

.claimQuantity {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.claimLabel {
  font-size: var(--text-metadata);
  font-weight: var(--weight-bold);
  color: var(--ink);
}

.claimInput {
  width: 100%;
  min-height: var(--control-height);
  padding: 0 var(--space-3);
  border: 1px solid var(--rule);
  border-radius: var(--radius-control);
  background: var(--paper-raised);
  color: var(--ink);
  font-family: inherit;
  font-size: var(--text-control);
}

.claimHelp {
  margin: 0;
  font-size: var(--text-metadata);
  line-height: 1.5;
  color: var(--ink-soft);
}

/*
 * The photo, on the who step's confirmation and on the done step.
 *
 * 12px like every other card and never a pill (design system). Height is
 * intrinsic rather than fixed so a portrait photo is not cropped by the layout
 * — this is somebody's picture of a tent or a gravestone, not an avatar.
 */
.photoThumb {
  display: block;
  width: 160px;
  max-width: 100%;
  height: auto;
  border: 1px solid var(--rule);
  border-radius: var(--radius-card);
  background: var(--paper-raised);
}

.buttonPrimary {
  width: 100%;
  min-height: var(--control-height);
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--accent-strong, #16233d);
  border-radius: var(--radius-control);
  background: var(--accent-strong, #16233d);
  color: var(--paper-raised);
  font-family: inherit;
  font-size: var(--text-control);
  font-weight: var(--weight-bold);
  cursor: pointer;
}

.buttonPrimary[disabled] {
  opacity: 0.5;
  cursor: default;
}

/* The other answer, and deliberately the same size as the first (M3-03).
   Declining an invitation is a complete answer, not an escape hatch — a page
   that makes "no" small is collecting agreements rather than asking a
   question. It differs by form, not prominence, which is the same rule the
   beads follow. */
.buttonSecondary {
  width: 100%;
  min-height: var(--control-height);
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--rule);
  border-radius: var(--radius-control);
  background: var(--paper-raised);
  color: var(--ink);
  font-family: inherit;
  font-size: var(--text-control);
  font-weight: var(--weight-bold);
  cursor: pointer;
}

.buttonQuiet {
  min-height: var(--hit-area-min);
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--rule);
  border-radius: var(--radius-control);
  background: var(--paper-raised);
  color: var(--ink);
  font-family: inherit;
  font-size: var(--text-metadata);
  font-weight: var(--weight-bold);
  cursor: pointer;
}

.claimed,
.conflict {
  margin-top: 12px;
  padding: 12px 14px;
  border: 1px solid var(--accent, #16233d);
  border-radius: var(--radius-control);
  background: var(--paper-raised);
}

/* A conflict is not the contributor's mistake, so it is not marked in red or
   anything like it — it is marked by the ink rule everything else uses. */
.conflict {
  border-color: var(--ink);
}

.claimedTitle {
  margin: 0;
  font-size: var(--text-body);
  font-weight: var(--weight-bold);
  color: var(--ink);
}

.claimedBody {
  margin: 6px 0 0;
  font-size: var(--text-metadata);
  line-height: 1.55;
  color: var(--ink-soft);
  text-wrap: pretty;
}

.payValue {
  margin: 8px 0 0;
  font-size: 26px;
  line-height: 1.1;
  font-weight: var(--weight-heavy);
  letter-spacing: 0.04em;
  color: var(--ink);
  word-break: break-all;
}

.notice {
  margin: 18px 0 0;
  padding: 12px 14px;
  border: 1px solid var(--accent, #16233d);
  border-radius: var(--radius-control);
  background: var(--paper-raised);
}

.noticeTitle {
  margin: 0;
  font-size: var(--text-body);
  font-weight: var(--weight-bold);
  color: var(--ink);
}

.noticeBody {
  margin: 6px 0 0;
  font-size: var(--text-metadata);
  line-height: 1.55;
  color: var(--ink-soft);
  text-wrap: pretty;
}

.safety {
  margin: 18px 20px 0;
  padding: 12px 14px;
  background: var(--paper-raised);
  border: 1px solid var(--rule);
  border-radius: var(--radius-control);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.safetyLine {
  margin: 0;
  font-size: var(--text-metadata);
  line-height: 1.5;
  color: var(--ink-soft);
  text-wrap: pretty;
}

.safetyLink {
  color: var(--ink);
  font-weight: 600;
}

.trust {
  margin-top: 26px;
  padding: 26px 20px 40px;
  border-top: 1px solid var(--rule);
  background: var(--paper-raised);
}

.trustBlock {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--rule);
}

.trustHeading {
  margin: 0 0 6px;
  font-size: var(--text-body);
  font-weight: var(--weight-bold);
}

.trustBody {
  margin: 0 0 10px;
  font-size: var(--text-body);
  line-height: 1.55;
  color: var(--ink-soft);
  text-wrap: pretty;
}

.trustList {
  margin: 0;
  padding-left: 20px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: var(--text-body);
  line-height: 1.5;
  color: var(--ink-soft);
  text-wrap: pretty;
}

.footer {
  padding: 22px 20px 40px;
  border-top: 1px solid var(--rule);
}

.footerText {
  margin: 0;
  font-size: var(--text-metadata);
  line-height: 1.6;
  color: var(--ink-soft);
  text-wrap: pretty;
}
`
