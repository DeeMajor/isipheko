/**
 * The collection page's styles, on top of the public page's.
 *
 * A string rather than a CSS Module for the same reason as `public-page-css.ts`:
 * this page is rendered from a route handler, which has no bundler step to run
 * CSS through (docs/decisions.md M1-08).
 *
 * Every accent usage is `var(--accent, #16233d)`, and the unit test that scans
 * for a bare `var(--accent)` covers this file too.
 */
export const COLLECTION_PAGE_CSS = String.raw`
/* ---- who holds the money (rule 16) --------------------------------- */

.custody {
  padding: 14px 15px;
  background: var(--paper-raised);
  border: 1px solid var(--rule);
  border-radius: var(--radius-card);
}

.custodyTitle {
  margin: 0;
  font-size: var(--text-body);
  font-weight: var(--weight-bold);
  color: var(--ink);
  text-wrap: pretty;
}

.custodyBody {
  margin: 6px 0 0;
  font-size: 14px;
  line-height: 1.55;
  color: var(--ink-soft);
  text-wrap: pretty;
}

/* ---- what the group is giving --------------------------------------- */

.givingCard {
  margin: 12px 0 0;
  padding: 16px;
  background: var(--paper-raised);
  border: 1px solid var(--rule);
  border-radius: var(--radius-card);
}

.givingHead {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}

.givingTitle {
  margin: 0;
  font-size: var(--text-title);
  font-weight: var(--weight-bold);
  letter-spacing: -0.015em;
  color: var(--ink);
}

/* The one thing the group has taken off the family's list, as a unit. */
.givingTag {
  flex: none;
  padding: 3px 7px;
  border: 1px solid var(--accent, #16233d);
  border-radius: var(--radius-control);
  font-size: 12px;
  font-weight: var(--weight-bold);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--accent, #16233d);
}

.givingBody {
  margin: 7px 0 0;
  font-size: 14px;
  line-height: 1.55;
  color: var(--ink-soft);
  text-wrap: pretty;
}

.givingWhy {
  margin: 9px 0 0;
  font-size: 14px;
  line-height: 1.55;
  font-weight: 600;
  color: var(--ink);
  text-wrap: pretty;
}

.total {
  margin: 16px 0 0;
  padding: 15px 16px;
  border: 1px solid var(--rule);
  border-radius: var(--radius-card);
}

.totalLabel {
  margin: 0;
  font-size: var(--text-metadata);
  color: var(--ink-soft);
}

/*
 * The running total, and the only large number in the product.
 *
 * It belongs to the group and nobody else: the host's page shows one bead with
 * no breakdown, and this page is the eight of them looking at their own pot.
 */
.totalAmount {
  margin: 5px 0 0;
  font-size: 30px;
  font-weight: var(--weight-heavy);
  letter-spacing: -0.03em;
  color: var(--ink);
}

.totalNote {
  margin: 6px 0 0;
  font-size: 14px;
  line-height: 1.5;
  color: var(--ink-soft);
}

/* ---- the roster ----------------------------------------------------- */

.roster {
  list-style: none;
  margin: 16px 0 0;
  padding: 0;
}

.rosterRow {
  display: flex;
  align-items: baseline;
  gap: 11px;
  padding: 11px 0;
  border-bottom: 1px solid var(--rule);
}

.rosterName {
  flex: 1;
  min-width: 0;
  font-size: var(--text-body);
  font-weight: 600;
  color: var(--ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.rosterNote {
  display: block;
  margin-top: 2px;
  font-size: var(--text-metadata);
  font-weight: 400;
  line-height: 1.45;
  color: var(--ink-soft);
}

.rosterAmount {
  flex: none;
  font-size: 14px;
  font-weight: var(--weight-bold);
  color: var(--ink);
}
`
