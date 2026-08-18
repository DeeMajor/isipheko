/**
 * The Ledger Strand's styles, as a string — same reason as
 * `public-page-css.ts`: the public page is a route handler with no bundler step
 * to run CSS through (docs/decisions.md M1-08), and this is inlined into its
 * head.
 *
 * Everything about a bead is drawn here rather than in markup. Each bead
 * carries two or three custom properties and nothing else, so two hundred of
 * them cost a few hundred bytes after compression against a 15KB allowance.
 *
 * Every accent usage is `var(--accent, #16233d)`. A bereavement page declares
 * no accent and its beads render indigo with nothing asking what archetype it
 * is (rule 2). The cords are ink on purpose: the string is not the offering.
 */
export const STRAND_CSS = String.raw`
.strandForm {
  margin: 20px 0 0;
}

.strand {
  list-style: none;
  margin: 0;
  padding: 0;
}

/* ---- one cord, up to thirty ---------------------------------------- */

.strandCord {
  position: relative;
}

.strandCord::before {
  content: '';
  position: absolute;
  left: 13px;
  top: 6px;
  bottom: 6px;
  width: 2px;
  background: var(--ink);
}

.strandCord .beadRow {
  position: relative;
}

.strandCord .beadButton {
  display: flex;
  align-items: center;
  gap: 14px;
  width: 100%;
  /* 46px is the single-cord pitch, and it is also the hit area. */
  min-height: 46px;
  padding: var(--space-1) 0 var(--space-1) 2px;
  background: transparent;
  border: 0;
  text-align: left;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.beadName {
  flex: 1;
  min-width: 0;
  font-size: var(--text-body);
  font-weight: 600;
  color: var(--ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.beadWhat {
  flex: none;
  font-size: var(--text-metadata);
  color: var(--ink-soft);
}

/* ---- braided, beyond thirty ---------------------------------------- */

.strandFrame {
  position: relative;
  height: var(--strand-height);
}

.cords {
  position: absolute;
  inset: 6px 0;
}

.cord {
  position: absolute;
  left: calc(50% + var(--x));
  top: 0;
  bottom: 0;
  width: 2px;
  margin-left: -1px;
  background: var(--ink);
}

/* Fills the frame, so the list is a box rather than a zero-height container. */
.strandBraid {
  position: absolute;
  inset: 0;
}

.strandBraid .beadRow {
  position: absolute;
  left: calc(50% + var(--x));
  top: var(--y);
  transform: translate(-50%, -50%);
}

.strandBraid .beadButton {
  display: flex;
  align-items: center;
  justify-content: center;
  /*
   * The hit area is 44px while the bead stays 6–24px (Part C.4). At the
   * densest band the pitch is 18px, so neighbouring targets overlap — the
   * strand is the picture, and a bead is reached by tapping near it.
   */
  width: var(--hit-area-min);
  height: var(--hit-area-min);
  padding: 0;
  background: transparent;
  border: 0;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.strandBraid .beadDot {
  /* Lifts each bead off the ones behind it where the strand is dense. */
  box-shadow: 0 0 0 3px var(--paper);
}

/* Read by a screen reader, drawn for nobody: the strand is a list either way. */
.beadHidden {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}

/* ---- the three bead forms ------------------------------------------ */

.beadMark {
  flex: none;
  width: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.beadDot {
  display: block;
  position: relative;
  width: var(--d);
  height: var(--d);
  border-radius: 50%;
}

/* Cash: a solid disc. */
.beadCash .beadDot {
  background: var(--accent, #16233d);
}

.beadCash .beadBar {
  display: none;
}

/*
 * In-kind: the same diameter, open, with a bar across it. Equal visual mass to
 * cash — the forms differ by shape, never by prominence. In-kind is the core of
 * what isipheko means, and a lighter bead would say otherwise.
 */
.beadKind .beadDot,
.beadGroup .beadDot {
  background: var(--paper-raised);
  border: 2px solid var(--accent, #16233d);
}

.beadKind .beadBar {
  display: block;
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: calc(var(--d) - 8px);
  height: 2px;
  background: var(--accent, #16233d);
}

/* A group: a ring around a bead. One bead per collection, never one per member. */
.beadGroup .beadBar {
  display: block;
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: calc(var(--d) - 10px);
  height: calc(var(--d) - 10px);
  border-radius: 50%;
  background: var(--accent, #16233d);
}

/* ---- an opened bead ------------------------------------------------- */

.beadPanel {
  margin: 0 0 10px 38px;
  padding: 12px 14px;
  background: var(--paper-raised);
  border: 1px solid var(--rule);
  border-radius: var(--radius-card);
}

/* The braided panel sits under the whole strand rather than under one row. */
.strandFrame + .beadPanel {
  margin-left: 0;
}

.beadPanelName {
  margin: 0;
  font-size: var(--text-body);
  font-weight: var(--weight-bold);
  color: var(--ink);
}

.beadPanelMessage {
  margin: 6px 0 0;
  font-size: var(--text-body);
  line-height: 1.5;
  color: var(--ink);
  text-wrap: pretty;
}

.beadMembers {
  margin: 11px 0 0;
  padding-top: 11px;
  border-top: 1px solid var(--rule);
}

.beadMembersLabel {
  margin: 0 0 7px;
  font-size: 12px;
  font-weight: var(--weight-bold);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--ink-soft);
}

.beadMemberNames {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
}

.beadMember {
  font-size: 14px;
  font-weight: 600;
  color: var(--ink);
}

.beadPanelMeta {
  margin: 8px 0 12px;
  font-size: var(--text-metadata);
  color: var(--ink-soft);
}

/*
 * The newest bead settling onto the strand, and **only** where the archetype
 * declares animate: true. Nothing emits this class on a bereavement page, and
 * prefers-reduced-motion in tokens.css turns it off for everybody who has asked
 * for no motion.
 */
@keyframes settle-bead {
  from {
    opacity: 0;
    transform: translateY(-14px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.beadNew .beadMark {
  animation: settle-bead 300ms cubic-bezier(0.2, 0.7, 0.3, 1) 1;
}
`
