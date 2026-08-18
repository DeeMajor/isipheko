/**
 * The incwadi's styles — a sheet of paper first, a screen second.
 *
 * The page exists to be printed and handed over, so the print rules are not an
 * afterthought here: no background colour to drink a family's ink, a black
 * border that survives a cheap printer, and nothing on the paper that only
 * makes sense on a screen.
 *
 * A string rather than a CSS Module because this is rendered from a route
 * handler, which has no bundler step (docs/decisions.md M1-08).
 */
export const INCWADI_CSS = String.raw`
body {
  background: var(--paper);
}

.sheet {
  max-width: 620px;
  margin: 0 auto;
  padding: 28px 24px 36px;
  background: var(--paper-raised);
  border: 1px solid var(--ink);
  border-radius: var(--radius-control);
}

.wordmark {
  margin: 0;
  font-size: 11px;
  font-weight: var(--weight-bold);
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--ink-soft);
}

.recordTitle {
  margin: 12px 0 0;
  font-size: 22px;
  font-weight: var(--weight-heavy);
  letter-spacing: -0.025em;
  color: var(--ink);
  text-wrap: pretty;
}

.recordSub {
  margin: 4px 0 0;
  font-size: 14px;
  line-height: 1.5;
  color: var(--ink-soft);
}

.rows {
  list-style: none;
  margin: 18px 0 0;
  padding: 16px 0 0;
  border-top: 1px solid var(--ink);
}

.row {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 7px 0;
  border-bottom: 1px dotted var(--rule);
}

.rowName {
  flex: 1;
  min-width: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--ink);
}

.rowAmount {
  flex: none;
  font-size: 14px;
  color: var(--ink);
}

.together {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  margin: 14px 0 0;
}

.togetherLabel {
  font-size: var(--text-body);
  font-weight: var(--weight-heavy);
  color: var(--ink);
}

.togetherAmount {
  font-size: var(--text-title);
  font-weight: var(--weight-heavy);
  color: var(--ink);
}

/*
 * How it was confirmed, and by whom. This is the part somebody reads in five
 * years, so it is on the paper rather than only on the screen.
 */
.foot {
  margin: 16px 0 0;
  padding-top: 14px;
  border-top: 1px solid var(--rule);
}

.footLine {
  margin: 0 0 4px;
  font-size: var(--text-metadata);
  line-height: 1.55;
  color: var(--ink-soft);
  text-wrap: pretty;
}

.printNote {
  margin: 14px 0 0;
  font-size: var(--text-metadata);
  line-height: 1.5;
  color: var(--ink-soft);
}

@media print {
  body {
    background: #ffffff;
  }

  .sheet {
    max-width: none;
    margin: 0;
    padding: 0;
    border: 0;
  }

  /* Instructions about printing have no business on the printed page. */
  .screenOnly {
    display: none;
  }

  .row {
    /* A name and its amount must not be split across two sheets. */
    break-inside: avoid;
  }
}
`
